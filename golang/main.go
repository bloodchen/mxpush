package main

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	"github.com/joho/godotenv"
	"github.com/teris-io/shortid"
)

var (
	tokenPass string
)

type Config struct {
	APIKeys []string `json:"apiKeys"`
}

type Client struct {
	UID    string
	SID    string
	Conn   *websocket.Conn
	Mutex  sync.Mutex
	Buffer []byte // 复用缓冲区减少内存分配
}

type Server struct {
	Clients map[string]*Client
	Mutex   sync.RWMutex
	Config  Config
}

type PostItem struct {
	UID  string      `json:"uid"`
	Data interface{} `json:"data"`
	R    bool        `json:"_r,omitempty"`
}

type PostRequest struct {
	Items []PostItem `json:"items"`
	Key   string     `json:"key"`
}

type User struct {
	UserID string `json:"user_id"`
}

// UnmarshalJSON 自定义JSON解析，处理user_id可能是数字或字符串的情况
func (u *User) UnmarshalJSON(data []byte) error {
	type Alias User
	aux := &struct {
		UserID interface{} `json:"user_id"`
		*Alias
	}{
		Alias: (*Alias)(u),
	}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	// 处理user_id可能是数字或字符串的情况
	switch v := aux.UserID.(type) {
	case string:
		u.UserID = v
	case float64:
		u.UserID = strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		u.UserID = strconv.Itoa(v)
	default:
		u.UserID = fmt.Sprintf("%v", v)
	}

	return nil
}

type Response struct {
	Code int         `json:"code"`
	Msg  string      `json:"msg,omitempty"`
	Data interface{} `json:"data,omitempty"`
}

// Fiber WebSocket doesn't need upgrader configuration

func NewServer() *Server {
	apiKeys := strings.Split(os.Getenv("API_KEYS"), ",")
	if len(apiKeys) == 1 && apiKeys[0] == "" {
		// Fallback to default if not set
		apiKeys = []string{"7ef733a9-6d07-4c9f-88c1-f3708f4362cc"}
	}
	return &Server{
		Clients: make(map[string]*Client),
		Config: Config{
			APIKeys: apiKeys,
		},
	}
}

func (s *Server) FindClient(uid string) *Client {
	s.Mutex.RLock()
	defer s.Mutex.RUnlock()
	return s.Clients[uid]
}

func (s *Server) AddClient(uid string, client *Client) {
	s.Mutex.Lock()
	defer s.Mutex.Unlock()
	s.Clients[uid] = client
}

func (s *Server) RemoveClient(uid string) {
	s.Mutex.Lock()
	defer s.Mutex.Unlock()
	delete(s.Clients, uid)
}

func (s *Server) GetClientCount() int {
	s.Mutex.RLock()
	defer s.Mutex.RUnlock()
	return len(s.Clients)
}

func decrypt(data, password string, fromEncoding string) (string, error) {
	var buf []byte
	var err error

	if fromEncoding == "hex" {
		buf, err = hex.DecodeString(data)
	} else {
		buf, err = base64.StdEncoding.DecodeString(data)
	}
	if err != nil {
		return "", err
	}

	if len(buf) < 16 {
		return "", fmt.Errorf("invalid data length")
	}

	iv := buf[:16]
	ciphertext := buf[16:]

	block, err := aes.NewCipher([]byte(password))
	if err != nil {
		return "", err
	}

	mode := cipher.NewCBCDecrypter(block, iv)
	mode.CryptBlocks(ciphertext, ciphertext)

	// Remove PKCS7 padding
	padding := int(ciphertext[len(ciphertext)-1])
	if padding > len(ciphertext) {
		return "", fmt.Errorf("invalid padding")
	}
	ciphertext = ciphertext[:len(ciphertext)-padding]

	return string(ciphertext), nil
}

func userFromToken(token string) (*User, error) {
	var data string
	var err error

	if strings.HasPrefix(token, "2-") {
		// v2 token
		data, err = decrypt(token[2:], tokenPass, "hex")
	} else {
		data, err = decrypt(token, tokenPass, "base64")
	}

	if err != nil {
		return nil, err
	}

	var user User
	err = json.Unmarshal([]byte(data), &user)
	if err != nil {
		return nil, err
	}

	return &user, nil
}

func authenticateFromURL(urlStr string) string {
	parts := strings.Split(urlStr, "?")
	if len(parts) < 2 {
		return ""
	}

	params := make(map[string]string)
	for _, param := range strings.Split(parts[1], "&") {
		kv := strings.Split(param, "=")
		if len(kv) == 2 {
			params[kv[0]] = kv[1]
		}
	}

	auth := params["auth"]
	if auth == "" {
		auth = "mx"
	}
	token := params["token"]
	uid := params["uid"]

	if uid == "" || token == "" {
		return ""
	}

	user, err := userFromToken(token)
	if err != nil {
		return ""
	}

	if auth == "mx" {
		mxid := strings.Split(uid, "_")[0]
		if mxid != user.UserID {
			return ""
		}
	}

	return uid
}

func (s *Server) handleWebSocket(c *websocket.Conn) {
	// 确保连接在函数退出时被关闭
	defer c.Close()
	
	// Authenticate from query parameters
	token := c.Query("token")
	uid := c.Query("uid")
	auth := c.Query("auth")
	if auth == "" {
		auth = "mx"
	}

	if uid == "" || token == "" {
		log.Printf("Authentication failed: missing uid or token")
		c.WriteMessage(websocket.CloseMessage, []byte("Unauthorized"))
		return
	}

	user, err := userFromToken(token)
	if err != nil {
		log.Printf("Authentication failed: invalid token")
		c.WriteMessage(websocket.CloseMessage, []byte("Unauthorized"))
		return
	}

	if auth == "mx" {
		mxid := strings.Split(uid, "_")[0]
		if mxid != user.UserID {
			log.Printf("Authentication failed: uid mismatch")
			c.WriteMessage(websocket.CloseMessage, []byte("Unauthorized"))
			return
		}
	}

	sid, _ := shortid.Generate()
	client := &Client{
		UID:  uid,
		SID:  sid,
		Conn: c,
	}

	s.AddClient(uid, client)
	log.Printf("Client connected: %s count: %d", uid, s.GetClientCount())

	defer func() {
		s.RemoveClient(uid)
		log.Printf("Client disconnected: %s count: %d", uid, s.GetClientCount())
	}()

	// 初始化缓冲区
	if client.Buffer == nil {
		client.Buffer = make([]byte, 0, 1024) // 预分配1KB缓冲区
	}

	// Handle messages with optimized memory usage
	for {
		// 设置读超时，防止连接假死导致goroutine泄漏
		c.SetReadDeadline(time.Now().Add(60 * time.Second))
		
		messageType, message, err := c.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		// 只处理文本消息，忽略二进制消息以节省内存
		if messageType == websocket.TextMessage {
			// 复用缓冲区，避免频繁分配
			client.Buffer = client.Buffer[:0]
			client.Buffer = append(client.Buffer, message...)
			log.Printf("Received message from %s: %s", uid, string(client.Buffer))
		}
	}
}

func (s *Server) handleGetURL(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"url": "this"})
}

func (s *Server) handleGetCount(c *fiber.Ctx) error {
	return c.SendString(strconv.Itoa(s.GetClientCount()))
}

func (s *Server) handleGetInfo(c *fiber.Ctx) error {
	uid := c.Query("uid")
	arr := []fiber.Map{}

	s.Mutex.RLock()
	for luid, client := range s.Clients {
		if strings.Split(luid, "_")[0] == uid {
			arr = append(arr, fiber.Map{
				"sid": client.SID,
				"uid": client.UID,
			})
		}
	}
	s.Mutex.RUnlock()

	return c.JSON(fiber.Map{
		"count": len(arr),
		"arr":   arr,
	})
}

// 预定义结构体减少内存分配
type IsOnlineRequest struct {
	UIDs interface{} `json:"uids"`
}

type IsOnlineResponse struct {
	Code   int      `json:"code"`
	Result []string `json:"result"`
}

func (s *Server) handleIsOnline(c *fiber.Ctx) error {
	// 使用预定义结构体而非gjson
	var req IsOnlineRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"code": 400, "msg": "invalid JSON"})
	}

	var uids []string
	switch v := req.UIDs.(type) {
	case []interface{}:
		// Handle array format
		uids = make([]string, 0, len(v))
		for _, uid := range v {
			uids = append(uids, fmt.Sprintf("%v", uid))
		}
	case string:
		// Handle string format
		uids = strings.Split(v, ",")
	default:
		return c.Status(400).JSON(fiber.Map{"code": 400, "msg": "uids field is required"})
	}

	// 预分配结果切片
	result := make([]string, 0, len(uids))
	for _, uid := range uids {
		if s.FindClient(uid) != nil {
			result = append(result, uid)
		}
	}

	return c.JSON(IsOnlineResponse{
		Code:   0,
		Result: result,
	})
}

// 优化的消息发送结构体
type MessageItem struct {
	UID  string                 `json:"uid"`
	R    bool                   `json:"r,omitempty"`
	Data map[string]interface{} `json:"-"` // 其他字段动态解析
}

type PostRequestOptimized struct {
	Items []json.RawMessage `json:"items"`
	Key   string            `json:"key"`
}

type PostResponse struct {
	Code        int                    `json:"code"`
	Delivered   int                    `json:"delivered"`
	Undelivered string                 `json:"undelivered"`
	Ret         map[string]interface{} `json:"ret"`
}

func (s *Server) handlePost(c *fiber.Ctx) error {
	// 使用优化的结构体解析
	var req PostRequestOptimized
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"code": 400, "msg": "invalid JSON"})
	}

	// Check API key
	validKey := false
	for _, key := range s.Config.APIKeys {
		if key == req.Key {
			validKey = true
			break
		}
	}
	if !validKey {
		return c.Status(401).JSON(fiber.Map{"code": 101, "msg": "invalid call"})
	}

	if len(req.Items) == 0 {
		return c.Status(400).JSON(fiber.Map{"code": 400, "msg": "items field is required and must be an array"})
	}

	log.Printf("Got message with %d items", len(req.Items))

	delivered := 0
	// 预分配map减少内存分配
	ret := make(map[string]interface{}, len(req.Items)*2)

	// 处理每个消息项
	for _, itemRaw := range req.Items {
		// 先解析基本字段
		var basicItem struct {
			UID string `json:"uid"`
			R   bool   `json:"r,omitempty"`
		}
		if err := json.Unmarshal(itemRaw, &basicItem); err != nil {
			continue
		}

		if basicItem.UID == "" {
			return c.Status(400).JSON(fiber.Map{"code": 400, "msg": "uid is missing"})
		}

		uids := strings.Split(basicItem.UID, ",")
		for _, uid := range uids {
			client := s.FindClient(uid)
			if client != nil {
				log.Printf("Found socket sid: %s uid: %s", client.SID, client.UID)

				if basicItem.R {
					// TODO: 实现请求-响应模式
					ret[uid] = fiber.Map{"code": 100, "msg": "request-response mode not implemented"}
				} else {
					// 解析完整消息并移除uid字段
					var fullMsg map[string]interface{}
					if err := json.Unmarshal(itemRaw, &fullMsg); err != nil {
						ret[uid] = fiber.Map{"code": 101, "msg": "parse error"}
						continue
					}
					delete(fullMsg, "uid") // 移除uid字段

					client.Mutex.Lock()
					err := client.Conn.WriteJSON(fullMsg)
					client.Mutex.Unlock()

					if err != nil {
						log.Printf("Send error: %v", err)
						ret[uid] = fiber.Map{"code": 101, "msg": "send failed"}
					} else {
						log.Printf("Message sent. %s[%s] msg: %+v", client.SID, client.UID, fullMsg)
						ret[uid] = fiber.Map{"code": 0, "msg": "data sent"}
						delivered++
					}
				}
			} else {
				log.Printf("Socket not found for: %s", uid)
				ret[uid] = fiber.Map{"code": 101, "msg": "socket broken"}
			}
		}
	}

	return c.JSON(PostResponse{
		Code:        0,
		Delivered:   delivered,
		Undelivered: "",
		Ret:         ret,
	})
}

func (s *Server) handleRoot(c *fiber.Ctx) error {
	ip := c.IP()
	return c.SendString(ip)
}

// 内存统计API
func (s *Server) handleMemStats(c *fiber.Ctx) error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	return c.JSON(fiber.Map{
		"alloc_kb":       m.Alloc / 1024,
		"total_alloc_kb": m.TotalAlloc / 1024,
		"sys_kb":         m.Sys / 1024,
		"heap_kb":        m.HeapAlloc / 1024,
		"heap_sys_kb":    m.HeapSys / 1024,
		"num_gc":         m.NumGC,
		"goroutines":     runtime.NumGoroutine(),
		"clients":        s.GetClientCount(),
		"gc_cpu_percent": m.GCCPUFraction * 100,
	})
}

// 内存优化配置
func setupMemoryOptimization() {
	// 设置GC目标百分比，降低内存使用
	debug.SetGCPercent(50) // 默认100，设置为50可以更频繁GC

	// 设置内存限制（如果环境变量中有设置）
	if memLimit := os.Getenv("GOMEMLIMIT"); memLimit != "" {
		log.Printf("Memory limit set to: %s", memLimit)
	}

	// 设置最大处理器数量
	if maxProcs := os.Getenv("GOMAXPROCS"); maxProcs == "" {
		// 如果没有设置，使用CPU核心数
		runtime.GOMAXPROCS(runtime.NumCPU())
	}

	log.Printf("Memory optimization configured - GC: 50%%, MaxProcs: %d", runtime.GOMAXPROCS(0))
}

// 内存监控
func startMemoryMonitor() {
	ticker := time.NewTicker(30 * time.Second) // 每30秒监控一次
	defer ticker.Stop()

	for range ticker.C {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)

		// 记录关键内存指标
		log.Printf("Memory Stats - Alloc: %d KB, TotalAlloc: %d KB, Sys: %d KB, NumGC: %d, Goroutines: %d",
			m.Alloc/1024,
			m.TotalAlloc/1024,
			m.Sys/1024,
			m.NumGC,
			runtime.NumGoroutine(),
		)

		// 如果内存使用过高，强制GC
		if m.Alloc > 100*1024*1024 { // 100MB
			log.Printf("High memory usage detected, forcing GC")
			runtime.GC()
		}
	}
}

func main() {
	// 内存优化配置
	setupMemoryOptimization()

	// Load environment variables from .env file
	err := godotenv.Load()
	if err != nil {
		log.Printf("Warning: Error loading .env file: %v", err)
	}

	// Initialize global variables from environment
	tokenPass = os.Getenv("TOKEN_PASSWORD")
	if tokenPass == "" {
		tokenPass = "2rnma5xsctJhx1Z$#%^09FYkRfuAsxTB" // fallback
	}

	// 启动内存监控
	go startMemoryMonitor()

	server := NewServer()

	app := fiber.New()

	// HTTP endpoints
	app.Get("/mxpush/url", server.handleGetURL)
	app.Get("/count", server.handleGetCount)
	app.Get("/mxpush/info/", server.handleGetInfo)
	app.Post("/mxpush/isonline", server.handleIsOnline)
	app.Post("/mxpush/post", server.handlePost)
	app.Get("/ip", server.handleRoot)
	app.Get("/memstats", server.handleMemStats) // 内存统计API

	// WebSocket endpoint
	app.Use("/", websocket.New(server.handleWebSocket))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting mxpush service on port: %s", port)
	log.Fatal(app.Listen(":" + port))
}

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
	"strconv"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	"github.com/joho/godotenv"
	"github.com/teris-io/shortid"
	"github.com/tidwall/gjson"
)

var (
	tokenPass string
)

type Config struct {
	APIKeys []string `json:"apiKeys"`
}

type Client struct {
	UID   string
	SID   string
	Conn  *websocket.Conn
	Mutex sync.Mutex
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

	// Handle messages
	for {
		_, message, err := c.ReadMessage()
		if err != nil {
			log.Printf("Read error: %v", err)
			break
		}
		log.Printf("Received message from %s: %s", uid, string(message))
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

func (s *Server) handleIsOnline(c *fiber.Ctx) error {
	// Get raw JSON body
	body := c.Body()

	// Use gjson to parse uids field
	uidsResult := gjson.GetBytes(body, "uids")
	if !uidsResult.Exists() {
		return c.Status(400).JSON(fiber.Map{"code": 400, "msg": "uids field is required"})
	}

	var uids []string
	if uidsResult.IsArray() {
		// Handle array format: ["uid1", "uid2"] or [123, 456]
		uidsResult.ForEach(func(_, value gjson.Result) bool {
			uids = append(uids, value.String())
			return true
		})
	} else {
		// Handle string format: "uid1,uid2"
		uids = strings.Split(uidsResult.String(), ",")
	}

	result := []string{}
	for _, uid := range uids {
		if s.FindClient(uid) != nil {
			result = append(result, uid)
		}
	}

	return c.JSON(fiber.Map{
		"code":   0,
		"result": result,
	})
}

func (s *Server) handlePost(c *fiber.Ctx) error {
	// Get raw JSON body
	body := c.Body()

	// Use gjson to parse key field
	keyResult := gjson.GetBytes(body, "key")
	if !keyResult.Exists() {
		return c.Status(400).JSON(fiber.Map{"code": 400, "msg": "key field is required"})
	}

	// Check API key
	validKey := false
	for _, key := range s.Config.APIKeys {
		if key == keyResult.String() {
			validKey = true
			break
		}
	}
	if !validKey {
		return c.Status(401).JSON(fiber.Map{"code": 101, "msg": "invalid call"})
	}

	// Use gjson to parse items array
	itemsResult := gjson.GetBytes(body, "items")
	if !itemsResult.Exists() || !itemsResult.IsArray() {
		return c.Status(400).JSON(fiber.Map{"code": 400, "msg": "items field is required and must be an array"})
	}

	log.Printf("Got message with %d items", len(itemsResult.Array()))

	delivered := 0
	ret := make(map[string]interface{})

	// Iterate through items using gjson
	var hasError bool
	var errorMsg string
	itemsResult.ForEach(func(_, itemResult gjson.Result) bool {
		// Get uid field from each item
		uidResult := itemResult.Get("uid")
		if !uidResult.Exists() || uidResult.String() == "" {
			hasError = true
			errorMsg = "uid is missing"
			return false // Stop iteration
		}

		uids := strings.Split(uidResult.String(), ",")
		for _, uid := range uids {
			client := s.FindClient(uid)
			if client != nil {
				log.Printf("Found socket sid: %s uid: %s", client.SID, client.UID)

				// Check if this is a request-response mode
				rResult := itemResult.Get("r")
				if rResult.Exists() && rResult.Bool() {
					// TODO: 实现请求-响应模式 (getReply功能)
					// 目前暂不支持_r模式，返回错误
					ret[uid] = fiber.Map{"code": 100, "msg": "request-response mode not implemented"}
				} else {
					// Create message without uid field using gjson
					msgMap := make(map[string]interface{})
					itemResult.ForEach(func(key, value gjson.Result) bool {
						if key.String() != "uid" {
							msgMap[key.String()] = value.Value()
						}
						return true
					})

					client.Mutex.Lock()
					err := client.Conn.WriteJSON(msgMap)
					client.Mutex.Unlock()

					if err != nil {
						log.Printf("Send error: %v", err)
						ret[uid] = fiber.Map{"code": 101, "msg": "send failed"}
					} else {
						log.Printf("Message sent. %s[%s] msg: %+v", client.SID, client.UID, msgMap)
						ret[uid] = fiber.Map{"code": 0, "msg": "data sent"}
						delivered++
					}
				}
			} else {
				log.Printf("Socket not found for: %s", uid)
				ret[uid] = fiber.Map{"code": 101, "msg": "socket broken"}
			}
		}
		return true // Continue iteration
	})

	// Check for errors that occurred during iteration
	if hasError {
		return c.Status(400).JSON(fiber.Map{"code": 100, "msg": errorMsg})
	}

	return c.JSON(fiber.Map{
		"code":        0,
		"delivered":   delivered,
		"undelivered": "",
		"ret":         ret,
	})
}

func (s *Server) handleRoot(c *fiber.Ctx) error {
	ip := c.IP()
	return c.SendString(ip)
}

func main() {
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

	server := NewServer()

	app := fiber.New()

	// HTTP endpoints
	app.Get("/mxpush/url", server.handleGetURL)
	app.Get("/count", server.handleGetCount)
	app.Get("/mxpush/info/", server.handleGetInfo)
	app.Post("/mxpush/isonline", server.handleIsOnline)
	app.Post("/mxpush/post", server.handlePost)
	app.Get("/ip", server.handleRoot)

	// WebSocket endpoint
	app.Use("/", websocket.New(server.handleWebSocket))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting mxpush service on port: %s", port)
	log.Fatal(app.Listen(":" + port))
}

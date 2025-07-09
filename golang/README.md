# mxpush - Golang Version

Golang implementation of the mxpush realtime push server.

## Features

- WebSocket-based real-time communication
- User authentication with token validation
- Message broadcasting to multiple clients
- RESTful API for server management
- Docker support
- High performance with Go's concurrency

## Quick Start

### Local Development

1. Install dependencies:
```bash
go mod tidy
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env file with your configuration
```

3. Run the server:
```bash
go run main.go
```

The server will start on port 8080 by default.

### Docker Deployment

1. Build the Docker image:
```bash
docker build -t mxpush-go .
```

2. Run the container:
```bash
docker run -p 8080:8080 mxpush-go
```

## API Endpoints

### WebSocket Connection
- `GET /` - WebSocket endpoint for client connections
  - Query parameters: `uid`, `token`, `auth` (optional, defaults to 'mx')

### HTTP Endpoints

#### Get Push Service URL
- `GET /mxpush/url`
- Returns: `{"url": "this"}`

#### Get Server Status
- `GET /count`
- Returns: Number of connected clients

#### Get Client Information
- `GET /mxpush/info/?uid={user_id}`
- Returns: List of connected clients for a specific user

#### Check Online Status
- `POST /mxpush/isonline`
- Body: `{"uids": "uid1,uid2,uid3"}`
- Returns: List of online UIDs

#### Send Messages
- `POST /mxpush/post`
- Body:
```json
{
    "items": [
        {
            "uid": "user_id_or_comma_separated_ids",
            "data": "message_data"
        }
    ],
    "key": "api_key"
}
```

#### Get Client IP
- `GET /ip`
- Returns: Client's IP address

## Configuration

### Environment Variables

The application supports configuration through environment variables. Copy `.env.example` to `.env` and modify as needed:

#### Server Configuration
- `PORT` - Server port (default: 8080)
- `GIN_MODE` - Gin mode (debug/release, default: debug)

#### Security Configuration
- `TOKEN_PASSWORD` - Password for token encryption/decryption
- `API_KEYS` - Comma-separated list of valid API keys

#### WebSocket Configuration
- `WS_IDLE_TIMEOUT` - WebSocket idle timeout in seconds (default: 60)
- `WS_MAX_PAYLOAD_LENGTH` - Maximum WebSocket payload length (default: 16777216)

#### Logging Configuration
- `LOG_LEVEL` - Log level (debug/info/warn/error)
- `LOG_FORMAT` - Log format (json/text)

#### CORS Configuration
- `CORS_ALLOWED_ORIGINS` - Allowed origins for CORS
- `CORS_ALLOWED_METHODS` - Allowed HTTP methods
- `CORS_ALLOWED_HEADERS` - Allowed headers

### API Keys
Configure API keys through the `API_KEYS` environment variable:
```bash
API_KEYS=key1,key2,key3
```

If not set, the default API key `7ef733a9-6d07-4c9f-88c1-f3708f4362cc` will be used.

## Authentication

Clients must provide valid authentication parameters:
- `uid` - User identifier
- `token` - Encrypted authentication token
- `auth` - Authentication method (optional, defaults to 'mx')

The token is decrypted using AES-256-CBC encryption with a predefined password.

## Dependencies

- [Gin](https://github.com/gin-gonic/gin) - HTTP web framework
- [Gorilla WebSocket](https://github.com/gorilla/websocket) - WebSocket implementation
- [ShortID](https://github.com/teris-io/shortid) - Short unique ID generator

## Performance

The Golang version offers several performance advantages:
- Native concurrency with goroutines
- Lower memory footprint
- Better CPU utilization
- Faster startup time
- Built-in HTTP/2 support

## Differences from Node.js Version

1. **Concurrency Model**: Uses goroutines instead of event loop
2. **Memory Management**: Automatic garbage collection with better performance
3. **Type Safety**: Statically typed with compile-time error checking
4. **Deployment**: Single binary deployment without runtime dependencies
5. **Performance**: Generally faster execution and lower resource usage

## Building for Production

```bash
# Build for current platform
go build -o mxpush main.go

# Build for Linux (common for deployment)
CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o mxpush main.go
```

## License

Same as the original project.
package gatewayws

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"time"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

type Client struct {
	conn   net.Conn
	reader *bufio.Reader
}

type DialOptions struct {
	Timeout     time.Duration
	TLSInsecure bool
}

// NewTestClient creates a client from an existing connection.
// It is primarily intended for tests that use net.Pipe.
func NewTestClient(conn net.Conn) *Client {
	return &Client{
		conn:   conn,
		reader: bufio.NewReader(conn),
	}
}

func Dial(rawURL string, opts DialOptions) (*Client, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return nil, fmt.Errorf("unsupported scheme: %s", u.Scheme)
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		if u.Scheme == "wss" {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	path := u.Path
	if path == "" {
		path = "/"
	}
	if u.RawQuery != "" {
		path += "?" + u.RawQuery
	}

	dialer := net.Dialer{Timeout: opts.Timeout}
	var conn net.Conn
	if u.Scheme == "wss" {
		tlsConn, err := tls.DialWithDialer(&dialer, "tcp", host, &tls.Config{
			InsecureSkipVerify: opts.TLSInsecure,
		})
		if err != nil {
			return nil, err
		}
		conn = tlsConn
	} else {
		c, err := dialer.Dial("tcp", host)
		if err != nil {
			return nil, err
		}
		conn = c
	}

	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		_ = conn.Close()
		return nil, err
	}
	secKey := base64.StdEncoding.EncodeToString(keyBytes)
	req := strings.Builder{}
	fmt.Fprintf(&req, "GET %s HTTP/1.1\r\n", path)
	fmt.Fprintf(&req, "Host: %s\r\n", u.Host)
	fmt.Fprintf(&req, "Upgrade: websocket\r\n")
	fmt.Fprintf(&req, "Connection: Upgrade\r\n")
	fmt.Fprintf(&req, "Sec-WebSocket-Key: %s\r\n", secKey)
	fmt.Fprintf(&req, "Sec-WebSocket-Version: 13\r\n")
	fmt.Fprintf(&req, "\r\n")
	if _, err := conn.Write([]byte(req.String())); err != nil {
		_ = conn.Close()
		return nil, err
	}

	reader := bufio.NewReader(conn)
	statusLine, err := reader.ReadString('\n')
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if !strings.Contains(statusLine, "101") {
		_ = conn.Close()
		return nil, fmt.Errorf("handshake failed: %s", strings.TrimSpace(statusLine))
	}
	accept := ""
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(line), "sec-websocket-accept:") {
			accept = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
		}
	}
	expected := computeAccept(secKey)
	if accept != expected {
		_ = conn.Close()
		return nil, fmt.Errorf("handshake accept mismatch")
	}

	return &Client{conn: conn, reader: reader}, nil
}

func (c *Client) Close() error {
	if c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

func (c *Client) ReadText() (string, error) {
	for {
		opcode, payload, err := c.readFrame()
		if err != nil {
			return "", err
		}
		switch opcode {
		case 1:
			return string(payload), nil
		case 8:
			return "", io.EOF
		case 9:
			_ = c.writeFrame(10, payload)
		case 10:
			continue
		default:
			continue
		}
	}
}

func (c *Client) WriteText(text string) error {
	return c.writeFrame(1, []byte(text))
}

func (c *Client) readFrame() (byte, []byte, error) {
	h1, err := c.reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	h2, err := c.reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	fin := h1&0x80 != 0
	opcode := h1 & 0x0f
	if !fin {
		return 0, nil, fmt.Errorf("fragmented frames not supported")
	}
	mask := h2&0x80 != 0
	length := int(h2 & 0x7f)
	if length == 126 {
		buf := make([]byte, 2)
		if _, err := io.ReadFull(c.reader, buf); err != nil {
			return 0, nil, err
		}
		length = int(buf[0])<<8 | int(buf[1])
	} else if length == 127 {
		buf := make([]byte, 8)
		if _, err := io.ReadFull(c.reader, buf); err != nil {
			return 0, nil, err
		}
		length = 0
		for i := 0; i < 8; i++ {
			length = (length << 8) | int(buf[i])
		}
	}
	var maskKey []byte
	if mask {
		maskKey = make([]byte, 4)
		if _, err := io.ReadFull(c.reader, maskKey); err != nil {
			return 0, nil, err
		}
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(c.reader, payload); err != nil {
		return 0, nil, err
	}
	if mask {
		for i := 0; i < len(payload); i++ {
			payload[i] ^= maskKey[i%4]
		}
	}
	return opcode, payload, nil
}

func (c *Client) writeFrame(opcode byte, payload []byte) error {
	fin := byte(0x80)
	header := []byte{fin | (opcode & 0x0f), 0}
	maskKey := make([]byte, 4)
	if _, err := rand.Read(maskKey); err != nil {
		return err
	}
	header[1] = 0x80
	length := len(payload)
	switch {
	case length < 126:
		header[1] |= byte(length)
	case length <= 65535:
		header[1] |= 126
		ext := []byte{byte(length >> 8), byte(length)}
		header = append(header, ext...)
	default:
		header[1] |= 127
		ext := make([]byte, 8)
		for i := 7; i >= 0; i-- {
			ext[i] = byte(length & 0xff)
			length >>= 8
		}
		header = append(header, ext...)
	}
	header = append(header, maskKey...)
	masked := make([]byte, len(payload))
	for i := range payload {
		masked[i] = payload[i] ^ maskKey[i%4]
	}
	if _, err := c.conn.Write(header); err != nil {
		return err
	}
	_, err := c.conn.Write(masked)
	return err
}

func computeAccept(key string) string {
	h := sha1.New()
	h.Write([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

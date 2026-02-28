package openclaw

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
)

type DeviceIdentity struct {
	DeviceID      string `json:"deviceId"`
	PublicKeyPem  string `json:"publicKeyPem"`
	PrivateKeyPem string `json:"privateKeyPem"`
}

type storedIdentity struct {
	Version       int    `json:"version"`
	DeviceID      string `json:"deviceId"`
	PublicKeyPem  string `json:"publicKeyPem"`
	PrivateKeyPem string `json:"privateKeyPem"`
	CreatedAtMs   int64  `json:"createdAtMs"`
}

var ed25519SPKIPrefix = []byte{0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00}

func base64URLEncode(data []byte) string {
	encoded := base64.StdEncoding.EncodeToString(data)
	encoded = strings.ReplaceAll(encoded, "+", "-")
	encoded = strings.ReplaceAll(encoded, "/", "_")
	encoded = strings.TrimRight(encoded, "=")
	return encoded
}

func base64URLDecode(input string) ([]byte, error) {
	input = strings.ReplaceAll(input, "-", "+")
	input = strings.ReplaceAll(input, "_", "/")
	padding := (4 - len(input)%4) % 4
	input += strings.Repeat("=", padding)
	return base64.StdEncoding.DecodeString(input)
}

func derivePublicKeyRaw(publicKeyPem string) ([]byte, error) {
	block, _ := pem.Decode([]byte(publicKeyPem))
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block")
	}

	if len(block.Bytes) == len(ed25519SPKIPrefix)+32 {
		hasPrefix := true
		for i := 0; i < len(ed25519SPKIPrefix); i++ {
			if block.Bytes[i] != ed25519SPKIPrefix[i] {
				hasPrefix = false
				break
			}
		}
		if hasPrefix {
			return block.Bytes[len(ed25519SPKIPrefix):], nil
		}
	}
	return block.Bytes, nil
}

func fingerprintPublicKey(publicKeyPem string) (string, error) {
	raw, err := derivePublicKeyRaw(publicKeyPem)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(raw)
	return fmt.Sprintf("%x", hash), nil
}

func generateIdentity() (*DeviceIdentity, error) {
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate key pair: %w", err)
	}

	pubKeyDER, err := x509.MarshalPKIXPublicKey(pubKey)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal public key: %w", err)
	}
	publicKeyPem := string(pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubKeyDER,
	}))

	privKeyDER, err := x509.MarshalPKCS8PrivateKey(privKey)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal private key: %w", err)
	}
	privateKeyPem := string(pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: privKeyDER,
	}))

	deviceID, err := fingerprintPublicKey(publicKeyPem)
	if err != nil {
		return nil, fmt.Errorf("failed to fingerprint public key: %w", err)
	}

	return &DeviceIdentity{
		DeviceID:      deviceID,
		PublicKeyPem:  publicKeyPem,
		PrivateKeyPem: privateKeyPem,
	}, nil
}

func LoadOrCreateDeviceIdentity(filePath string) (*DeviceIdentity, error) {
	if filePath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("failed to get home directory: %w", err)
		}
		filePath = filepath.Join(home, ".openclaw", "identity", "device.json")
	}

	if _, err := os.Stat(filePath); err == nil {
		data, err := os.ReadFile(filePath)
		if err == nil {
			var stored storedIdentity
			if err := json.Unmarshal(data, &stored); err == nil {
				if stored.Version == 1 && stored.DeviceID != "" && stored.PublicKeyPem != "" && stored.PrivateKeyPem != "" {
					derivedID, err := fingerprintPublicKey(stored.PublicKeyPem)
					if err == nil {
						if derivedID != stored.DeviceID {
							stored.DeviceID = derivedID
							data, _ := json.MarshalIndent(stored, "", "  ")
							os.WriteFile(filePath, append(data, '\n'), 0600)
						}
						return &DeviceIdentity{
							DeviceID:      stored.DeviceID,
							PublicKeyPem:  stored.PublicKeyPem,
							PrivateKeyPem: stored.PrivateKeyPem,
						}, nil
					}
				}
			}
		}
	}

	identity, err := generateIdentity()
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	stored := storedIdentity{
		Version:       1,
		DeviceID:      identity.DeviceID,
		PublicKeyPem:  identity.PublicKeyPem,
		PrivateKeyPem: identity.PrivateKeyPem,
		CreatedAtMs:   time.Now().UnixMilli(),
	}

	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal identity: %w", err)
	}

	if err := os.WriteFile(filePath, append(data, '\n'), 0600); err != nil {
		return nil, fmt.Errorf("failed to write identity file: %w", err)
	}

	logger.Log.Info().
		Str("deviceId", identity.DeviceID).
		Str("path", filePath).
		Msg(i18n.T(i18n.MsgLogDeviceIdentityGenerated))

	return identity, nil
}

func SignDevicePayload(privateKeyPem string, payload string) (string, error) {
	block, _ := pem.Decode([]byte(privateKeyPem))
	if block == nil {
		return "", fmt.Errorf("failed to decode private key PEM")
	}

	privKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("failed to parse private key: %w", err)
	}

	ed25519Key, ok := privKey.(ed25519.PrivateKey)
	if !ok {
		return "", fmt.Errorf("not an ed25519 private key")
	}

	signature := ed25519.Sign(ed25519Key, []byte(payload))
	return base64URLEncode(signature), nil
}

func PublicKeyRawBase64URLFromPem(publicKeyPem string) (string, error) {
	raw, err := derivePublicKeyRaw(publicKeyPem)
	if err != nil {
		return "", err
	}
	return base64URLEncode(raw), nil
}

func DeriveDeviceIDFromPublicKey(publicKey string) (string, error) {
	var raw []byte
	var err error

	if strings.Contains(publicKey, "BEGIN") {
		raw, err = derivePublicKeyRaw(publicKey)
		if err != nil {
			return "", err
		}
	} else {
		raw, err = base64URLDecode(publicKey)
		if err != nil {
			return "", err
		}
	}

	hash := sha256.Sum256(raw)
	return fmt.Sprintf("%x", hash), nil
}

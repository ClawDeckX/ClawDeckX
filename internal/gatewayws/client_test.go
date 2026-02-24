package gatewayws

import (
	"bufio"
	"net"
	"testing"
)

func TestTextFrameRoundTrip(t *testing.T) {
	c1, c2 := net.Pipe()
	defer c1.Close()
	defer c2.Close()

	clientA := &Client{conn: c1, reader: bufio.NewReader(c1)}
	clientB := &Client{conn: c2, reader: bufio.NewReader(c2)}

	go func() {
		_ = clientA.WriteText("hello")
	}()

	msg, err := clientB.ReadText()
	if err != nil {
		t.Fatalf("ReadText error: %v", err)
	}
	if msg != "hello" {
		t.Fatalf("unexpected message: %s", msg)
	}
}

func TestReadWriteFrame(t *testing.T) {
	c1, c2 := net.Pipe()
	defer c1.Close()
	defer c2.Close()

	clientA := &Client{conn: c1, reader: bufio.NewReader(c1)}
	clientB := &Client{conn: c2, reader: bufio.NewReader(c2)}

	go func() {
		_ = clientA.writeFrame(1, []byte("payload"))
	}()

	op, payload, err := clientB.readFrame()
	if err != nil {
		t.Fatalf("readFrame error: %v", err)
	}
	if op != 1 {
		t.Fatalf("unexpected opcode: %d", op)
	}
	if string(payload) != "payload" {
		t.Fatalf("unexpected payload: %s", string(payload))
	}
}

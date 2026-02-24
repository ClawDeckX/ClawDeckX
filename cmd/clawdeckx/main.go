package main

import (
	"os"

	"ClawDeckX/internal/cli"
)

func main() {
	os.Exit(cli.Run(os.Args))
}

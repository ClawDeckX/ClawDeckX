package prompt

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func IsInteractive() bool {
	info, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

func AskString(label, defaultValue string) (string, error) {
	if defaultValue != "" {
		fmt.Printf("%s [%s]: ", label, defaultValue)
	} else {
		fmt.Printf("%s: ", label)
	}

	reader := bufio.NewReader(os.Stdin)
	text, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return defaultValue, nil
	}
	return text, nil
}

func AskOptionalString(label string) (string, error) {
	fmt.Printf("%s: ", label)
	reader := bufio.NewReader(os.Stdin)
	text, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(text), nil
}

func AskBool(label string, defaultValue bool) (bool, error) {
	defaultText := "否"
	if defaultValue {
		defaultText = "是"
	}
	fmt.Printf("%s [默认:%s]: ", label, defaultText)

	reader := bufio.NewReader(os.Stdin)
	text, err := reader.ReadString('\n')
	if err != nil {
		return false, err
	}
	text = strings.TrimSpace(strings.ToLower(text))
	if text == "" {
		return defaultValue, nil
	}
	if text == "y" || text == "yes" || text == "是" || text == "true" {
		return true, nil
	}
	if text == "n" || text == "no" || text == "否" || text == "false" {
		return false, nil
	}
	return defaultValue, nil
}

type Option struct {
	Label string
	Value string
	Hint  string
}

func AskSelect(label string, options []Option, defaultValue string) (string, error) {
	if len(options) == 0 {
		return defaultValue, nil
	}
	fmt.Printf("%s:\n", label)
	defaultIndex := -1
	for i, opt := range options {
		line := fmt.Sprintf("  %d. %s", i+1, opt.Label)
		if opt.Hint != "" {
			line += "  - " + opt.Hint
		}
		if opt.Value == defaultValue {
			line += " [默认]"
			defaultIndex = i + 1
		}
		fmt.Println(line)
	}
	if defaultIndex > 0 {
		fmt.Printf("输入序号 [%d]: ", defaultIndex)
	} else {
		fmt.Printf("输入序号: ")
	}

	reader := bufio.NewReader(os.Stdin)
	text, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		if defaultIndex > 0 {
			return options[defaultIndex-1].Value, nil
		}
		return defaultValue, nil
	}
	idx, err := strconv.Atoi(text)
	if err != nil || idx < 1 || idx > len(options) {
		return defaultValue, nil
	}
	return options[idx-1].Value, nil
}

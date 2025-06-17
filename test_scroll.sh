#!/bin/bash

# Test script to demonstrate Arbiter's scroll functionality
echo "Testing Arbiter scroll functionality..."
echo "This script will run Arbiter with a prompt that generates enough output to test scrolling."
echo ""

# Create a test prompt that will generate multiple lines of output
./target/debug/arbiter "Please list the files in this directory and then explain what each Rust file does in this project."
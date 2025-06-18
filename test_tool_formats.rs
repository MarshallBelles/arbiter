#!/usr/bin/env rust-script

// Test script to verify tool argument format handling
// This can be run with: cargo run --bin test_tool_formats

use serde_json::{json, Value};

// Simulate the prepare_tool_args function from shell.rs
fn prepare_tool_args(tool_name: &str, args: &str) -> Value {
    // First, try to parse the args as JSON
    if let Ok(parsed_json) = serde_json::from_str::<Value>(args) {
        // If it's already valid JSON, check if it has the expected structure for this tool
        match tool_name {
            "shell_command" => {
                if parsed_json.get("command").is_some() {
                    return parsed_json;
                }
            }
            "write_file" => {
                if parsed_json.get("path").is_some() && parsed_json.get("content").is_some() {
                    return parsed_json;
                }
            }
            "read_file" => {
                if parsed_json.get("path").is_some() {
                    return parsed_json;
                }
            }
            "git_command" => {
                if parsed_json.get("command").is_some() {
                    return parsed_json;
                }
            }
            "code_analysis" => {
                if parsed_json.get("path").is_some() {
                    return parsed_json;
                }
            }
            "debug_directory" => {
                return parsed_json;
            }
            _ => {
                return parsed_json;
            }
        }
    }

    // Fallback to string-based parsing for pure XML/text arguments
    match tool_name {
        "shell_command" => {
            json!({
                "command": args.trim()
            })
        }
        "write_file" => {
            let args = args.trim();
            
            if let Some(newline_pos) = args.find('\n') {
                let (path, content) = args.split_at(newline_pos);
                json!({
                    "path": path.trim(),
                    "content": content[1..].to_string()
                })
            } else if let Some(pipe_pos) = args.find('|') {
                let (path, content) = args.split_at(pipe_pos);
                json!({
                    "path": path.trim(),
                    "content": content[1..].trim()
                })
            } else if let Some(space_pos) = args.find(' ') {
                let (path, content) = args.split_at(space_pos);
                json!({
                    "path": path.trim(),
                    "content": content[1..].to_string()
                })
            } else {
                json!({
                    "path": args,
                    "content": ""
                })
            }
        }
        "read_file" => {
            json!({
                "path": args.trim()
            })
        }
        "git_command" => {
            json!({
                "command": args.trim()
            })
        }
        "code_analysis" => {
            json!({
                "path": args.trim()
            })
        }
        "debug_directory" => {
            json!({})
        }
        _ => {
            json!({
                "args": args.trim()
            })
        }
    }
}

fn main() {
    println!("Testing Tool Argument Format Handling\n");
    
    // Test cases: [tool_name, input, expected_key, expected_value]
    let test_cases = vec![
        // JSON format tests
        ("shell_command", r#"{"command": "ls -la"}"#, "command", "ls -la"),
        ("read_file", r#"{"path": "src/main.rs"}"#, "path", "src/main.rs"),
        ("write_file", r#"{"path": "test.txt", "content": "Hello World"}"#, "path", "test.txt"),
        ("git_command", r#"{"command": "status"}"#, "command", "status"),
        ("code_analysis", r#"{"path": "src/lib.rs"}"#, "path", "src/lib.rs"),
        
        // Plain text format tests
        ("shell_command", "ls -la", "command", "ls -la"),
        ("read_file", "src/main.rs", "path", "src/main.rs"),
        ("git_command", "status", "command", "status"),
        ("code_analysis", "src/lib.rs", "path", "src/lib.rs"),
        
        // write_file special formats
        ("write_file", "test.txt\nHello World", "path", "test.txt"),
        ("write_file", "test.txt|Hello World", "path", "test.txt"),
        ("write_file", "test.txt Hello World", "path", "test.txt"),
    ];
    
    let mut passed = 0;
    let mut failed = 0;
    
    for (tool_name, input, expected_key, expected_value) in test_cases {
        let result = prepare_tool_args(tool_name, input);
        
        if let Some(actual_value) = result.get(expected_key).and_then(|v| v.as_str()) {
            if actual_value == expected_value {
                println!("✅ {}: {} -> {}", tool_name, input.replace('\n', "\\n"), actual_value);
                passed += 1;
            } else {
                println!("❌ {}: {} -> Expected '{}', got '{}'", tool_name, input.replace('\n', "\\n"), expected_value, actual_value);
                failed += 1;
            }
        } else {
            println!("❌ {}: {} -> Missing key '{}'", tool_name, input.replace('\n', "\\n"), expected_key);
            println!("   Result: {}", result);
            failed += 1;
        }
    }
    
    // Test write_file content parsing
    println!("\nTesting write_file content parsing:");
    let write_tests = vec![
        ("test.txt\nHello World", "Hello World"),
        ("test.txt|Hello World", "Hello World"),
        ("test.txt Hello World", " World"), // Note: space-separated keeps the space
    ];
    
    for (input, expected_content) in write_tests {
        let result = prepare_tool_args("write_file", input);
        if let Some(actual_content) = result.get("content").and_then(|v| v.as_str()) {
            if actual_content == expected_content {
                println!("✅ write_file content: {} -> '{}'", input.replace('\n', "\\n"), actual_content);
                passed += 1;
            } else {
                println!("❌ write_file content: {} -> Expected '{}', got '{}'", input.replace('\n', "\\n"), expected_content, actual_content);
                failed += 1;
            }
        }
    }
    
    println!("\nResults: {} passed, {} failed", passed, failed);
    
    if failed == 0 {
        println!("🎉 All tests passed! Both JSON and plain text formats work correctly.");
    } else {
        println!("⚠️  Some tests failed. Please check the implementation.");
    }
}
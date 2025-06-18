# Arbiter Multi-Endpoint Configuration

Arbiter supports running different AI models on different machines/endpoints, allowing you to distribute the computational load across multiple Mac Minis or other systems running Ollama.

## Configuration Structure

The orchestration system supports per-model endpoint configuration:

```toml
[orchestration]
enabled = true
max_iterations = 10
context_compression_threshold = 6000
model_switch_cooldown_ms = 500

# Arbiter model (reasoning) - Mac Mini #1
[orchestration.arbiter_model]
name = "arbiter"
temperature = 0.7
description = "Reasoning and planning model for complex tasks"
server = "http://192.168.1.100:11434"  # Your first Mac Mini's IP
enabled = true

# Winchester model (execution) - Mac Mini #2  
[orchestration.winchester_model]
name = "winchester"
temperature = 0.15
description = "Execution and coding model for precise implementation"
server = "http://192.168.1.101:11434"  # Your second Mac Mini's IP
enabled = true
```

## Setup Instructions

### 1. Configure Your Mac Minis

**Mac Mini #1 (Arbiter Model):**
```bash
# Install and start Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Create the Arbiter model
ollama create arbiter -f models/Modelfile.arbiter

# Verify it's running
ollama list
```

**Mac Mini #2 (Winchester Model):**
```bash
# Install and start Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Create the Winchester model  
ollama create winchester -f models/Modelfile.winchester

# Verify it's running
ollama list
```

### 2. Network Configuration

Ensure both Mac Minis are accessible over your network:

1. **Find IP addresses:**
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```

2. **Test connectivity:**
   ```bash
   # From your main machine, test both endpoints
   curl http://192.168.1.100:11434/api/tags
   curl http://192.168.1.101:11434/api/tags
   ```

3. **Update Arbiter config:**
   ```bash
   # Edit your config file
   arbiter "edit config"
   
   # Or copy the example
   cp config_example_multi_endpoint.toml ~/.config/arbiter/config.toml
   ```

### 3. Configuration Options

**Per-Model Settings:**
- `name`: Model name in Ollama
- `temperature`: Model creativity (0.15 for precise execution, 0.7 for reasoning)
- `description`: Human-readable description
- `server`: Full HTTP endpoint URL
- `enabled`: Whether this model is available for use

**Orchestration Settings:**
- `enabled`: Enable/disable model orchestration
- `max_iterations`: Prevent infinite loops (default: 10)
- `context_compression_threshold`: Token limit before compression (default: 6000)
- `model_switch_cooldown_ms`: Minimum time between switches (default: 500ms)

## Usage Examples

### Basic Multi-Endpoint Usage

```bash
# Direct prompt - will use appropriate model automatically
arbiter "Create a Python script to analyze log files"

# Interactive mode - shows model switching in real-time
arbiter
> Can you help me debug this Rust code?
```

### Monitoring Model Switching

Arbiter will log model switches and endpoint usage:

```
INFO Initializing AI client with arbiter model (http://192.168.1.100:11434)
INFO Switching from arbiter (http://192.168.1.100:11434) to winchester (http://192.168.1.101:11434)
DEBUG Sending streaming request to http://192.168.1.101:11434 using winchester model
```

### Single-Endpoint Fallback

If one model is unavailable, Arbiter can operate with just one:

```toml
[orchestration.arbiter_model]
enabled = true
server = "http://localhost:11434"

[orchestration.winchester_model]  
enabled = false  # Disable if second machine is unavailable
```

## Performance Benefits

**Load Distribution:**
- **Arbiter (Reasoning)**: Heavy thinking, planning, analysis
- **Winchester (Execution)**: Precise tool calls, code generation

**Resource Optimization:**
- Each model optimized for its specialized role
- No context switching overhead on single machine
- Better utilization of available hardware

**Scalability:**
- Easy to add more specialized models
- Can distribute across more machines as needed
- Maintains single unified interface

## Troubleshooting

### Connection Issues

```bash
# Test individual endpoints
curl -X POST http://192.168.1.100:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"arbiter","prompt":"test","stream":false}'
```

### Model Loading Issues

```bash
# Check model availability on each machine
ollama list

# Recreate models if needed
ollama create arbiter -f models/Modelfile.arbiter
ollama create winchester -f models/Modelfile.winchester
```

### Configuration Validation

```bash
# Arbiter will validate configuration on startup
arbiter --help  # Shows current config status
```

### Firewall/Network Issues

Ensure port 11434 is open on both machines:

```bash
# macOS
sudo pfctl -f /etc/pf.conf

# Or temporarily disable firewall for testing
sudo pfctl -d
```

## Advanced Configuration

### Custom Ports

```toml
[orchestration.arbiter_model]
server = "http://192.168.1.100:8080"  # Custom port

[orchestration.winchester_model]
server = "http://192.168.1.101:9090"  # Custom port
```

### Load Balancing Multiple Instances

For high-availability setups, you can use a load balancer:

```toml
[orchestration.arbiter_model]
server = "http://arbiter-cluster.local:11434"  # Load balancer endpoint
```

This setup allows you to maximize the performance of your local AI infrastructure while maintaining the intelligent orchestration capabilities of Arbiter.
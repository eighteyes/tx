---
allowed-tools:
- Read(*)
- Write(*)
- Bash(find *)
- Bash(mkdir *)
- LS(*)
description: Generate deterministic scripts/setup.sh based on detected project type
permalink: commands/lb/gen-setup
---

## Context

**Project type detection**: !`find . -maxdepth 2 -name "package.json" -o -name "requirements.txt" -o -name "pyproject.toml" -o -name "Cargo.toml" -o -name "go.mod" -o -name "pom.xml" -o -name "docker-compose.yml" | head -5`

**Existing setup files**: !`find . -name "setup.sh" -o -name "setup.py" -o -name "Makefile" -o -name "scripts" | head -5`

**Environment files**: !`find . -name ".env.example" -o -name ".env.template" -o -name "config.example.*" | head -3`

## Your task

Generate a deterministic `scripts/setup.sh` script based on detected project type. Arguments: $ARGUMENTS

### Script Generation Process

1. **Detect project type** from package files
2. **Create scripts directory** if it doesn't exist
3. **Generate setup script** with appropriate commands for detected type
4. **Make script executable** 
5. **Test script validity** (syntax check)

### Template Selection

**JavaScript/Node.js Projects:**
```bash
#!/bin/bash
# Auto-generated setup script for Node.js project
set -e

echo "🔧 Setting up Node.js project..."

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js not installed. Install from https://nodejs.org/"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm not installed"; exit 1; }

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Setup environment
if [ -f ".env.example" ]; then
    echo "📋 Setting up environment file..."
    cp .env.example .env
    echo "✅ Created .env from .env.example"
fi

# Run setup scripts if they exist
if npm run setup --silent >/dev/null 2>&1; then
    echo "🚀 Running setup script..."
    npm run setup
fi

echo "✅ Setup complete!"
```

**Python Projects:**
```bash
#!/bin/bash
# Auto-generated setup script for Python project
set -e

echo "🔧 Setting up Python project..."

# Check prerequisites
command -v python3 >/dev/null 2>&1 || { echo "Python 3 not installed"; exit 1; }

# Virtual environment
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

echo "🔌 Activating virtual environment..."
source venv/bin/activate

# Install dependencies
if [ -f "requirements.txt" ]; then
    echo "📦 Installing dependencies from requirements.txt..."
    pip install -r requirements.txt
elif [ -f "pyproject.toml" ]; then
    echo "📦 Installing dependencies from pyproject.toml..."
    pip install -e .
fi

# Setup environment
if [ -f ".env.example" ]; then
    echo "📋 Setting up environment file..."
    cp .env.example .env
    echo "✅ Created .env from .env.example"
fi

# Django setup
if [ -f "manage.py" ]; then
    echo "🗃️  Running Django migrations..."
    python manage.py migrate
fi

echo "✅ Setup complete!"
echo "💡 Activate venv with: source venv/bin/activate"
```

**Rust Projects:**
```bash
#!/bin/bash
# Auto-generated setup script for Rust project
set -e

echo "🔧 Setting up Rust project..."

# Check prerequisites
command -v rustc >/dev/null 2>&1 || { echo "Rust not installed. Install from https://rustup.rs/"; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Cargo not installed"; exit 1; }

# Build dependencies
echo "📦 Building dependencies..."
cargo build

# Setup environment
if [ -f ".env.example" ]; then
    echo "📋 Setting up environment file..."
    cp .env.example .env
    echo "✅ Created .env from .env.example"
fi

echo "✅ Setup complete!"
```

**Go Projects:**
```bash
#!/bin/bash
# Auto-generated setup script for Go project
set -e

echo "🔧 Setting up Go project..."

# Check prerequisites
command -v go >/dev/null 2>&1 || { echo "Go not installed. Install from https://golang.org/"; exit 1; }

# Download dependencies
echo "📦 Downloading dependencies..."
go mod download

# Build project
echo "🔨 Building project..."
go build

# Setup environment
if [ -f ".env.example" ]; then
    echo "📋 Setting up environment file..."
    cp .env.example .env
    echo "✅ Created .env from .env.example"
fi

echo "✅ Setup complete!"
```

**Docker Projects:**
```bash
#!/bin/bash
# Auto-generated setup script for Docker project
set -e

echo "🔧 Setting up Docker project..."

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker not installed"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo "Docker Compose not installed"; exit 1; }

# Setup environment
if [ -f ".env.example" ]; then
    echo "📋 Setting up environment file..."
    cp .env.example .env
    echo "✅ Created .env from .env.example"
fi

# Build images
echo "🏗️  Building Docker images..."
docker-compose build

# Start database/services
echo "🗃️  Starting services..."
docker-compose up -d

echo "✅ Setup complete!"
echo "💡 View logs with: docker-compose logs -f"
```

### Multi-language Projects

If multiple project types detected, generate a script that handles all of them in logical order.

### Output Requirements

1. **Create `scripts/` directory** if it doesn't exist
2. **Generate `scripts/setup.sh`** with appropriate template
3. **Make script executable**: `chmod +x scripts/setup.sh`
4. **Test script syntax**: `bash -n scripts/setup.sh`
5. **Provide usage instructions**

### Success Criteria

- ✅ Project type correctly detected
- ✅ Appropriate setup script generated
- ✅ Script is executable and syntax-valid
- ✅ Handles environment file setup
- ✅ Includes prerequisite checks
- ✅ Provides clear user feedback

Generate the setup script now.
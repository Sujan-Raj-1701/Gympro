#!/bin/bash
# CyberPanel Deployment Script for Salon POS Backend
# Domain: nadarsmatrimonial.com

set -e

echo "🚀 Starting CyberPanel deployment for Salon POS Backend..."

# Variables
DOMAIN="hub.techiesmagnifier.com"
APP_DIR="/home/${DOMAIN}/public_html/api"
PYTHON_DIR="/home/${DOMAIN}/python"
VENV_DIR="${PYTHON_DIR}/salon_pos_venv"
LOGS_DIR="/home/${DOMAIN}/logs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Step 1: Create directory structure
echo_info "Creating directory structure..."
sudo mkdir -p "${APP_DIR}"
sudo mkdir -p "${LOGS_DIR}"
sudo mkdir -p "${PYTHON_DIR}"

# Step 2: Set permissions
echo_info "Setting up permissions..."
sudo chown -R ${DOMAIN}:${DOMAIN} "/home/${DOMAIN}"
sudo chmod -R 755 "/home/${DOMAIN}/public_html"

# Step 3: Create Python virtual environment
echo_info "Creating Python virtual environment..."
cd "${PYTHON_DIR}"
python3 -m venv salon_pos_venv
source salon_pos_venv/bin/activate

# Step 4: Install Python dependencies
echo_info "Installing Python dependencies..."
pip install --upgrade pip
pip install wheel setuptools

# Install FastAPI and dependencies
pip install fastapi==0.104.1
pip install uvicorn[standard]==0.24.0
pip install gunicorn==21.2.0
pip install pymysql==1.1.0
pip install sqlalchemy==2.0.36
pip install python-jose[cryptography]==3.3.0
pip install passlib[bcrypt]==1.7.4
pip install python-multipart==0.0.6
pip install pydantic==2.9.2
pip install mysql-connector-python==8.2.0
pip install cryptography==41.0.7
pip install pytz==2023.3
pip install python-dotenv==1.0.0

# Additional packages for production
pip install asgiref==3.7.2  # For WSGI compatibility

echo_info "Installed packages:"
pip list

# Step 5: Copy application files
echo_info "Copying application files..."
cp -r /path/to/your/fastapi_backend/* "${APP_DIR}/"

# Step 6: Set up environment file
echo_info "Setting up environment configuration..."
if [ -f "${APP_DIR}/.env.production" ]; then
    cp "${APP_DIR}/.env.production" "${APP_DIR}/.env"
    echo_info "Production environment file configured"
else
    echo_warning "No .env.production file found. Please create it manually."
fi

# Step 7: Test the application
echo_info "Testing FastAPI application..."
cd "${APP_DIR}"
source "${VENV_DIR}/bin/activate"

# Test import
python -c "from main import app; print('✅ FastAPI app imported successfully')"

# Step 8: Set up Gunicorn service
echo_info "Setting up Gunicorn service..."
cat > /etc/systemd/system/salon-pos-backend.service << EOF
[Unit]
Description=Salon POS FastAPI Backend
After=network.target

[Service]
Type=notify
User=${DOMAIN}
Group=${DOMAIN}
WorkingDirectory=${APP_DIR}
Environment="PATH=${VENV_DIR}/bin"
ExecStart=${VENV_DIR}/bin/gunicorn main:app --bind 127.0.0.1:8000 --workers 2 --worker-class uvicorn.workers.UvicornWorker --timeout 120 --keep-alive 2 --max-requests 1000 --max-requests-jitter 50
ExecReload=/bin/kill -s HUP \$MAINPID
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable salon-pos-backend
sudo systemctl start salon-pos-backend

# Step 9: Configure Nginx (if not using CyberPanel's interface)
echo_info "Nginx configuration created. Please apply it through CyberPanel interface."
echo_info "Configuration file: ${APP_DIR}/nginx.conf"

# Step 10: Create database and user (MySQL commands)
echo_info "Database setup commands (run these in MySQL):"
echo "CREATE DATABASE salon_pos_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "CREATE USER 'salon_pos_user'@'localhost' IDENTIFIED BY 'your_secure_password_here';"
echo "GRANT ALL PRIVILEGES ON salon_pos_db.* TO 'salon_pos_user'@'localhost';"
echo "FLUSH PRIVILEGES;"

# Step 11: Final checks
echo_info "Running final checks..."

# Check if service is running
if systemctl is-active --quiet salon-pos-backend; then
    echo_info "✅ Salon POS Backend service is running"
else
    echo_error "❌ Service failed to start. Check logs: journalctl -u salon-pos-backend"
fi

# Check if port is listening
if ss -tlnp | grep -q ":8000"; then
    echo_info "✅ Application is listening on port 8000"
else
    echo_warning "⚠️  Port 8000 is not listening. Check service status."
fi

# Test API endpoint
echo_info "Testing API health endpoint..."
sleep 5
if curl -f http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo_info "✅ Health endpoint is responding"
else
    echo_warning "⚠️  Health endpoint not responding. Check application logs."
fi

echo_info "🎉 Deployment completed!"
echo_info ""
echo_info "Next steps:"
echo_info "1. Update .env file with your database credentials"
echo_info "2. Run database migrations/setup"
echo_info "3. Configure SSL certificate through CyberPanel"
echo_info "4. Set up Nginx proxy through CyberPanel interface"
echo_info "5. Test your API at: https://${DOMAIN}/api/health"
echo_info ""
echo_info "Useful commands:"
echo_info "- Check service: sudo systemctl status salon-pos-backend"
echo_info "- View logs: sudo journalctl -u salon-pos-backend -f"
echo_info "- Restart service: sudo systemctl restart salon-pos-backend"
echo_info "- Check port: ss -tlnp | grep 8000"

echo_info "🔧 Don't forget to:"
echo_info "1. Replace 'your_secure_password_here' in .env with actual secure passwords"
echo_info "2. Replace 'your_super_secret_jwt_key_here' with a strong JWT secret"
echo_info "3. Update CORS origins in main.py to include your domain"
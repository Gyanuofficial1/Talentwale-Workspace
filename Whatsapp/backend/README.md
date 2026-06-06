# TalentWale Backend

Backend server for WhatsApp and Email campaign management built with Node.js.

## 📋 Features

- ✅ WhatsApp template messaging via Azure Communication Services
- ✅ Bulk email campaign management
- ✅ SMTP configuration and validation
- ✅ Email analytics and tracking
- ✅ File upload handling (XLSX support)
- ✅ PostgreSQL database integration
- ✅ Azure Queue integration for async processing

## 🚀 Quick Start

### Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Update .env with your credentials
# Then run server
npm run dev
```

### Production

```bash
npm install --production
npm start
```

Server runs on: `http://localhost:3000`

## 📦 Dependencies

- `@azure-rest/communication-messages` - WhatsApp messaging
- `@azure/storage-queue` - Queue management
- `pg` - PostgreSQL client
- `nodemailer` - Email sending
- `xlsx` - Excel file parsing
- `dotenv` - Environment configuration

## 🌍 Environment Variables

Copy `.env.example` to `.env` and update:

```
AZURE_COMMUNICATION_CONNECTION_STRING=your_value
DATABASE_URL=postgresql://user:password@localhost:5432/db
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_password
PORT=3000
NODE_ENV=development
```

## 📁 Project Structure

```
backend/
├── server.js                 # Main server file
├── send-whatsapp.js         # WhatsApp messaging logic
├── src/                     # Utility functions
├── uploads/                 # Uploaded files
├── package.json
├── .env.example
└── Dockerfile
```

## 🔌 API Endpoints

### WhatsApp
- `POST /api/whatsapp/send` - Send WhatsApp message
- `POST /api/whatsapp/bulk` - Bulk send WhatsApp
- `GET /api/whatsapp/templates` - Get templates

### Email
- `POST /api/email/send` - Send email
- `POST /api/email/campaign` - Create campaign
- `GET /api/email/analytics` - Get analytics

### Config
- `GET /api/config/status` - Server status
- `POST /api/config/update` - Update settings

## 🐳 Docker Deployment

```bash
# Build image
docker build -t talentwale-backend .

# Run container
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e AZURE_COMMUNICATION_CONNECTION_STRING=... \
  talentwale-backend
```

## ☁️ AWS Deployment

### Lambda + API Gateway

```bash
# Build deployment package
zip -r backend.zip .

# Upload to AWS Lambda
aws lambda create-function \
  --function-name talentwale-backend \
  --runtime nodejs18.x \
  --role arn:aws:iam::ACCOUNT:role/lambda-role \
  --handler server.handler \
  --zip-file fileb://backend.zip
```

### EC2 Deployment

```bash
# SSH into EC2
ssh -i key.pem ec2-user@instance-ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repo and start
git clone <repo>
cd backend
npm install
npm start
```

## 📊 Database Setup

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE talentwale;

# Create tables (see migration files)
\i migrations/001_init.sql
```

## 🔒 Security

- ✅ Environment variables for secrets
- ✅ CORS enabled
- ✅ Rate limiting (configurable)
- ✅ Input validation
- ✅ Database connection pooling

## 🛠️ Scripts

```bash
npm run dev       # Start with nodemon (development)
npm start         # Start server (production)
npm test          # Run tests
npm run migrate   # Run database migrations
```

## 📝 Logs

Logs are saved in the `logs/` directory. Check logs:

```bash
tail -f logs/server.log
```

## 🆘 Troubleshooting

### Port already in use
```bash
lsof -i :3000
kill -9 <PID>
```

### Database connection error
- Verify `DATABASE_URL` in `.env`
- Check PostgreSQL is running
- Test connection: `psql <connection_string>`

### Azure service errors
- Verify `AZURE_COMMUNICATION_CONNECTION_STRING`
- Check Azure Communication Service is active
- Verify phone numbers are formatted correctly

## 📚 API Documentation

Full API docs available at: `/api/docs` (Swagger UI - if implemented)

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/name`
2. Commit changes: `git commit -m 'Add feature'`
3. Push: `git push origin feature/name`
4. Create Pull Request

## 📄 License

ISC License

## 📞 Support

For issues and support, contact: helpdesk@talentwale.com

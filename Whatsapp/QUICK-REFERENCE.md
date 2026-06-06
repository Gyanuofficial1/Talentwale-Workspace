# Frontend/Backend Separation - Quick Reference

## 📁 New Structure

```
✅ CREATED - Frontend & Backend Folders
│
├── frontend/                        ← Deploy to AWS Amplify / S3
│   ├── src/                        (Copy frontend files here)
│   ├── public/                     (SVG assets, images)
│   ├── package.json               ✅
│   ├── .env.example               ✅
│   ├── README.md                  ✅
│   └── Dockerfile                 ✅
│
├── backend/                         ← Deploy to AWS Lambda / EC2
│   ├── server.js                  (Copy from root)
│   ├── send-whatsapp.js           (Copy from root)
│   ├── src/                       (Copy from root)
│   ├── uploads/
│   ├── package.json               ✅
│   ├── .env.example               ✅
│   ├── README.md                  ✅
│   ├── Dockerfile                 ✅
│   └── lambda.toml                ✅
│
├── docker-compose.yml             ✅ (Local dev)
├── buildspec.yml                  ✅ (AWS CodeBuild)
├── buildspec-frontend.yml         ✅ (AWS CodeBuild)
├── AWS-DEPLOYMENT-GUIDE.md        ✅ (Complete guide)
├── README.md                      ✅ (Updated)
└── SEPARATION-COMPLETE.md         ✅ (This checklist)
```

---

## 🎯 Next Actions (3 Steps)

### Step 1: Copy Backend Files
```bash
cp server.js backend/
cp send-whatsapp.js backend/
cp -r src/* backend/src/
cd backend && npm install
```

### Step 2: Copy Frontend Files
```bash
cp public/index.html frontend/src/
cp public/app.js frontend/src/
cp public/styles.css frontend/src/
cp talentwale-candidate-outreach.html frontend/src/
cp bd.html frontend/src/
cp mail.html frontend/src/
cp public/*.svg frontend/public/
```

### Step 3: Test Locally
```bash
docker-compose up -d
# Backend:  http://localhost:3000
# Frontend: http://localhost:3001
```

---

## 💰 AWS Costs (with $100 credit)

```
Monthly Cost After Separation:
├── Lambda Backend:     $0-2        (pay per use)
├── Amplify Frontend:   $0          (free forever)
├── RDS Database:       $0          (12 months free)
└── Total:              $0-2/month

$100 Credit Duration: 50+ months! 🎉

Old Setup (EC2):
├── EC2 Instance:       $10/month
└── $100 Credit:        ~10 months
```

---

## 📚 Documentation

| File | Content |
|------|---------|
| **README.md** | Main project guide |
| **AWS-DEPLOYMENT-GUIDE.md** | Complete AWS setup (Lambda/EC2/S3) |
| **backend/README.md** | Backend API documentation |
| **frontend/README.md** | Frontend UI guide |
| **SEPARATION-COMPLETE.md** | Detailed checklist |

---

## 🚀 Deployment Paths

### Path 1: Lambda + Amplify (Best for $100 credit) ⭐
```
1. npm install in backend/
2. Create Lambda function (upload backend.zip)
3. Create API Gateway (REST API)
4. Deploy frontend to Amplify (git push)
5. Configure RDS database
Estimated cost: $0.50-2/month
```

### Path 2: EC2 + S3
```
1. Launch EC2 t2.micro
2. SSH and install Node.js
3. Clone repo and npm install
4. Run with PM2
5. Upload frontend to S3
Estimated cost: $10-15/month
```

### Path 3: Docker + ECS
```
1. Build Docker images
2. Push to ECR
3. Deploy to ECS
4. Configure load balancer
Estimated cost: $15-30/month
```

---

## ⚡ Local Development

### Using Docker Compose (Recommended)
```bash
docker-compose up -d

# Services:
# - Backend: http://localhost:3000
# - Frontend: http://localhost:3001
# - PostgreSQL: localhost:5432
```

### Manual Setup
```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend
cd frontend && python -m http.server 3001
```

---

## 🔧 Environment Setup

### Backend (.env)
```
AZURE_COMMUNICATION_CONNECTION_STRING=...
DATABASE_URL=postgresql://user:pass@localhost:5432/talentwale
SMTP_HOST=smtp.gmail.com
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_password
PORT=3000
```

### Frontend (.env)
```
REACT_APP_API_URL=http://localhost:3000
REACT_APP_API_TIMEOUT=30000
```

---

## ✅ Files Created

### Configuration
- ✅ `backend/package.json`
- ✅ `backend/.env.example`
- ✅ `backend/.gitignore`
- ✅ `frontend/package.json`
- ✅ `frontend/.env.example`
- ✅ `frontend/.gitignore`

### Docker & Deployment
- ✅ `backend/Dockerfile`
- ✅ `frontend/Dockerfile`
- ✅ `docker-compose.yml`
- ✅ `backend/lambda.toml`
- ✅ `buildspec.yml` (CodeBuild)
- ✅ `buildspec-frontend.yml` (CodeBuild)

### Documentation
- ✅ `README.md` (Updated)
- ✅ `backend/README.md`
- ✅ `frontend/README.md`
- ✅ `AWS-DEPLOYMENT-GUIDE.md`
- ✅ `SEPARATION-COMPLETE.md`

---

## 🎯 Deployment Checklist

Frontend (Amplify):
- [ ] Push code to GitHub
- [ ] Connect GitHub repo to Amplify
- [ ] Configure build settings
- [ ] Deploy

Backend (Lambda):
- [ ] npm install --production
- [ ] Create deployment package
- [ ] Create Lambda function
- [ ] Configure API Gateway
- [ ] Set environment variables

Database (RDS):
- [ ] Create PostgreSQL instance
- [ ] Configure security groups
- [ ] Run migrations
- [ ] Update DATABASE_URL

---

## 💡 Quick Tips

### Cost Optimization
- Use Lambda for low traffic ✅
- Use Amplify for static frontend ✅
- Use RDS free tier ✅
- Monitor CloudWatch alarms ✅

### Performance
- Enable CloudFront CDN for frontend
- Configure Lambda provisioned concurrency (if needed)
- Use RDS read replicas (if needed)
- Monitor cold starts

### Security
- Never commit .env files
- Use AWS Secrets Manager
- Enable HTTPS/SSL
- Configure CORS properly
- Use IAM roles

---

## 📞 Support Files

| Issue | Reference |
|-------|-----------|
| Backend API | `backend/README.md` |
| Frontend UI | `frontend/README.md` |
| AWS Setup | `AWS-DEPLOYMENT-GUIDE.md` |
| Docker Setup | `docker-compose.yml` |
| Project Overview | `README.md` |

---

## 🎉 Ready to Deploy!

1. ✅ Folders created
2. ✅ Config files generated
3. ✅ Documentation ready
4. ⏭️ Copy source files to folders
5. ⏭️ Setup environment variables
6. ⏭️ Deploy to AWS

See `AWS-DEPLOYMENT-GUIDE.md` for complete deployment instructions!

---

**Created**: June 4, 2026
**Status**: ✅ Ready for deployment

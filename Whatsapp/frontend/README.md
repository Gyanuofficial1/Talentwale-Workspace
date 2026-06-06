# TalentWale Frontend

Static frontend UI for TalentWale candidate outreach and dashboard.

## 📋 Features

- ✅ Responsive design (mobile-first)
- ✅ Email templates (HTML)
- ✅ Dashboard UI
- ✅ Form controls and validation
- ✅ Real-time status updates
- ✅ Multi-page application

## 🚀 Quick Start

### Local Development

```bash
# Option 1: Using Python (no installation needed)
cd frontend/src
python -m http.server 3001

# Option 2: Using Node.js
cd frontend
npm install
npm start
```

Frontend runs on: `http://localhost:3001`

## 📁 Project Structure

```
frontend/
├── src/                                    # Main source files
│   ├── index.html                         # Main dashboard
│   ├── app.js                             # JavaScript logic
│   ├── styles.css                         # Stylesheets
│   └── ...html files                      # Additional pages
├── public/                                # Static assets
│   ├── dual_layer.svg                     # Logo
│   ├── Full_wide.svg                      # Banner assets
│   └── ...icons/images
├── package.json
├── .env.example
└── Dockerfile
```

## 🎨 Pages

### Dashboard Pages
- **index.html** - Main dashboard with navigation
- **Quick Send** - Send individual WhatsApp/Email
- **Bulk Send** - Batch send campaigns
- **Email Campaign** - Email management
- **Analytics** - Performance tracking
- **Config** - Settings management
- **Chat Inbox** - Message inbox

### Email Templates
- **talentwale-candidate-outreach.html** - Candidate outreach template
- **bd.html** - Business development template
- **mail.html** - General email template

## 🌍 Environment Variables

Create `.env` file:

```
REACT_APP_API_URL=http://localhost:3000
REACT_APP_API_TIMEOUT=30000
REACT_APP_ENABLE_ANALYTICS=true
REACT_APP_ENABLE_CHAT=true
```

## 📦 Deployment

### AWS Amplify (Recommended)

```bash
# Install Amplify CLI
npm install -g @aws-amplify/cli

# Initialize Amplify
amplify init

# Deploy
amplify publish
```

### AWS S3 + CloudFront

```bash
# Build (copy files)
npm run build

# Upload to S3
aws s3 sync frontend/src s3://your-bucket-name

# Invalidate CloudFront (optional)
aws cloudfront create-invalidation \
  --distribution-id YOUR_DIST_ID \
  --paths "/*"
```

### Docker

```bash
# Build image
docker build -t talentwale-frontend .

# Run container
docker run -p 3001:3001 talentwale-frontend
```

### Static Server

```bash
# Using Python
cd frontend/src
python -m http.server 3001

# Using Node.js http-server
npx http-server frontend/src -p 3001 -c-1
```

## 🔗 API Integration

Frontend communicates with backend via:

```javascript
const API_URL = process.env.REACT_APP_API_URL;

// Example API call
fetch(`${API_URL}/api/whatsapp/send`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
})
```

## 🎯 Features Breakdown

### Dashboard Components
- **Sidebar Navigation** - Main menu navigation
- **Status Indicator** - Real-time connection status
- **Form Controls** - Input validation
- **Data Tables** - Campaign listing
- **Charts** - Analytics visualization

### Email Templates
- Mobile responsive design
- Dark mode support
- Template variable placeholders
- Unsubscribe links
- Social media links

## 🛠️ Scripts

```bash
npm start         # Start development server
npm run build     # Build for production (copy files)
npm run deploy    # Deploy to AWS (if configured)
```

## 📱 Browser Support

- ✅ Chrome (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Edge (latest)
- ✅ Mobile browsers

## 🔒 Security

- ✅ No sensitive data in frontend
- ✅ CORS configured
- ✅ Content Security Policy headers
- ✅ XSS protection
- ✅ Environment variables for API endpoints

## 📊 Performance

- ✅ Static files (no build required)
- ✅ CDN ready (CloudFront)
- ✅ Gzip compression
- ✅ Minified assets

## 🐛 Troubleshooting

### CORS Error
- Check `API_URL` in `.env`
- Verify backend CORS configuration
- Ensure backend is running

### Page not loading
- Check browser console for errors
- Verify all assets are served
- Check file permissions

### Styling issues
- Clear browser cache (Ctrl+Shift+Del)
- Verify `styles.css` is loaded
- Check CSS file paths

## 📚 File Naming Conventions

```
Components:        *.html
Styles:            styles.css
Scripts:           app.js
Assets:            src/assets/
Templates:         templates/
```

## 🚀 Deployment Checklist

- [ ] Update `REACT_APP_API_URL` to production backend
- [ ] Test all links and forms
- [ ] Verify responsive design on mobile
- [ ] Check console for errors
- [ ] Test email templates in different clients
- [ ] Verify analytics tracking
- [ ] Setup CloudFront CDN (if using)
- [ ] Enable HTTPS
- [ ] Setup custom domain (if needed)

## 📄 License

ISC License

## 📞 Support

For issues: helpdesk@talentwale.com

# Fleet Booking System Documentation

Deploy this documentation site to Vercel with ease.

## 🚀 Quick Deploy to Vercel

### Option 1: Deploy with Vercel CLI

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

3. Deploy from this directory:
   ```bash
   vercel
   ```

### Option 2: Deploy via GitHub

1. Push this code to a GitHub repository
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Vercel will automatically detect this as a static site and deploy it

### Option 3: Deploy via Git Integration

1. Connect your repository to Vercel
2. Set the build settings:
   - **Build Command**: `echo "Static site - no build required"`
   - **Output Directory**: `.` (current directory)
   - **Install Command**: `npm install` (optional)

## 📁 Project Structure

This is a static HTML documentation site with the following structure:

```
docs_site/
├── index.html              # Main landing page
├── installation.html       # Installation guide
├── user-guide.html        # User guide
├── api.html               # API documentation
├── developer-guide.html   # Developer guide
├── changelog.html         # Changelog
├── faq.html              # FAQ
├── about.html            # About page
├── glossary.html         # Glossary
├── style.css             # Main stylesheet
├── main.js               # JavaScript functionality
├── package.json          # Project configuration
├── vercel.json           # Vercel deployment configuration
└── README.md             # This file
```

## 🔧 Configuration

The site is configured with:

- **Static file serving** via `@vercel/static`
- **Automatic routing** for all HTML files
- **No build process required** - pure static HTML/CSS/JS

## 🌐 Environment Variables

This static site doesn't require any environment variables for basic deployment.

## 📝 Customization

To customize the deployment:

1. Edit `vercel.json` for advanced routing or headers
2. Modify `package.json` for project metadata
3. Update the HTML files for content changes

## 🔗 Links

- [Vercel Documentation](https://vercel.com/docs)
- [Static Site Deployment Guide](https://vercel.com/docs/concepts/deployments/overview)

# Demo 2 Frontend

## First-Time Setup

### 1) Prerequisites
- Node.js 20+ (Node 22 recommended)
- npm (included with Node)
- Backend API running on `http://127.0.0.1:8000`

### 2) Clone and install
```bash
git clone <your-repo-url>
cd demo_2
npm install
```

### 3) Start development server
```bash
npm run dev
```
Open the URL shown in terminal (usually `http://localhost:5173`).


## Backend Connectivity

During local development, this app calls `/api/*` and Vite proxies that to:

- `http://127.0.0.1:8000/*`

Configured in `vite.config.ts`.

Expected backend endpoints include:
- `GET /cases`
- `GET /cases/{case_id}`
- `GET /documents/{document_id}`
- `POST /run_case/{case_id}`
- `POST /analyze_files`

## Optional API Base URL Override

The app reads `VITE_API_BASE_URL` and defaults to `/api` if not set.

To override, create `.env`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

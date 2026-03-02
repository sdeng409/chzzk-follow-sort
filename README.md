# chzzk-follow

A browser extension to enhance the Chzzk following list with custom sorting.

## Prerequisites

- Node.js (v18 or later)
- npm

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

## Build Instructions

To build the extension for production:
```bash
npm run build
```
The build output will be generated in the `dist/` directory.

## Development Workflow

To start a watch build that automatically updates on changes:
```bash
npm run dev
```

## Loading the Extension

1. Open Chrome or Edge and navigate to `chrome://extensions`.
2. Enable "Developer mode" in the top right corner.
3. Click "Load unpacked".
4. Select the `dist/` folder in this project directory.

## Features

- API-based sort modes for your following live channels:
  - 추천순 (`RECOMMEND`)
  - 시청자 많은 순 (`POPULAR`)
  - 시청자 적은 순 (`UNPOPULAR`)
  - 최신 라이브 순 (`LATEST`)
  - 오래된 라이브 순 (`OLDEST`)
- Sort mode persistence across sessions.
- Adds a sort dropdown directly above the left-side "팔로잉 채널" list when available.

## Privacy and Storage

- Sort mode preference is stored in browser storage (`chzzkFollowSort.sortMode`).
- The extension reads API sort order from `https://api.chzzk.naver.com/service/v1/channels/following-lives?sortType=<SORT_TYPE>`.

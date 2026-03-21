/// <reference types="vite/client" />

import type { API } from '../main/preload'

declare global {
  interface Window {
    api: API
  }
}

export {}

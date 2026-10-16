/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string
    readonly VITE_API_KEY: string
    readonly VITE_CO2DATA_API_KEY: string
    readonly VITE_RTS_API_KEY: string
    readonly VITE_VTT_API_KEY: string
    readonly VITE_MAPBOX_ACCESS_TOKEN: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
} 
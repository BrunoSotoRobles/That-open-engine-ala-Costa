/// <reference types="vite/client" />

declare module 'web-ifc' {
    const WebIFC: any;
    export default WebIFC;
}

interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
} 
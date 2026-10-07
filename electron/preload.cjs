const {
    contextBridge,
    ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld("orbit", {
    quit: () => {
        ipcRenderer.send("orbit-quit");
    },

    startSpotifyLogin: (authUrl) => {
        return ipcRenderer.invoke(
            "spotify-login",
            authUrl
        );
    }
});
import {
    app,
    BrowserWindow,
    ipcMain,
    shell
} from "electron";

import path from "path";
import http from "http";

import {
    fileURLToPath
} from "url";

const __filename =
    fileURLToPath(import.meta.url);

const __dirname =
    path.dirname(__filename);

const SPOTIFY_CALLBACK_PORT = 43821;

const SPOTIFY_CALLBACK_URL =
    `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}/callback`;

let mainWindow = null;
let spotifyServer = null;


// ==========================================
// CREATE ORBIT WINDOW
// ==========================================

function createWindow() {
    mainWindow =
        new BrowserWindow({
            width: 1400,
            height: 850,

            minWidth: 500,
            minHeight: 400,

            backgroundColor:
                "#381d36",

            autoHideMenuBar: true,

            webPreferences: {
                preload:
                    path.join(
                        __dirname,
                        "preload.cjs"
                    ),

                contextIsolation: true,
                nodeIntegration: false
            }
        });


    // ========================================
    // DEVELOPMENT VS INSTALLED APP
    // ========================================

    if (app.isPackaged) {
        mainWindow.loadFile(
            path.join(
                __dirname,
                "../dist/index.html"
            )
        );
    } else {
        mainWindow.loadURL(
            "http://127.0.0.1:5174/"
        );
    }


    mainWindow.on(
        "closed",
        () => {
            mainWindow = null;
        }
    );
}


// ==========================================
// SPOTIFY CALLBACK SERVER
// ==========================================

function closeSpotifyServer() {
    if (spotifyServer) {
        spotifyServer.close();
        spotifyServer = null;
    }
}


function waitForSpotifyCallback() {
    return new Promise(
        (resolve, reject) => {

            closeSpotifyServer();

            let finished = false;

            const timeout = setTimeout(
                () => {
                    if (finished) {
                        return;
                    }

                    finished = true;

                    closeSpotifyServer();

                    reject(
                        new Error(
                            "Spotify login timed out."
                        )
                    );
                },
                5 * 60 * 1000
            );


            spotifyServer =
                http.createServer(
                    (request, response) => {

                        const requestUrl =
                            new URL(
                                request.url,
                                SPOTIFY_CALLBACK_URL
                            );

                        if (
                            requestUrl.pathname !==
                            "/callback"
                        ) {
                            response.writeHead(404);
                            response.end(
                                "Not found"
                            );

                            return;
                        }


                        const code =
                            requestUrl.searchParams.get(
                                "code"
                            );

                        const state =
                            requestUrl.searchParams.get(
                                "state"
                            );

                        const error =
                            requestUrl.searchParams.get(
                                "error"
                            );


                        response.writeHead(
                            200,
                            {
                                "Content-Type":
                                    "text/html; charset=utf-8"
                            }
                        );

                        response.end(`
              <!doctype html>

              <html>
                <head>
                  <meta charset="utf-8">

                  <title>
                    Orbit
                  </title>

                  <style>
                    * {
                      box-sizing: border-box;
                    }

                    body {
                      margin: 0;

                      min-height: 100vh;

                      display: flex;
                      align-items: center;
                      justify-content: center;

                      font-family:
                        Arial,
                        sans-serif;

                      color: white;

                      background:
                        linear-gradient(
                          145deg,
                          #ac7c94,
                          #381d36
                        );
                    }

                    main {
                      text-align: center;

                      padding: 40px;
                    }

                    h1 {
                      margin-bottom: 10px;
                    }

                    p {
                      opacity: 0.75;
                    }
                  </style>
                </head>

                <body>
                  <main>
                    <h1>
                      Connected to Orbit
                    </h1>

                    <p>
                      You can close this window and return to Orbit.
                    </p>
                  </main>
                </body>
              </html>
            `);


                        if (finished) {
                            return;
                        }

                        finished = true;

                        clearTimeout(timeout);

                        setTimeout(
                            closeSpotifyServer,
                            500
                        );


                        if (error) {
                            reject(
                                new Error(
                                    `Spotify login failed: ${error}`
                                )
                            );

                            return;
                        }


                        if (!code || !state) {
                            reject(
                                new Error(
                                    "Spotify did not return the required login information."
                                )
                            );

                            return;
                        }


                        resolve({
                            code,
                            state
                        });
                    }
                );


            spotifyServer.once(
                "error",
                error => {
                    if (finished) {
                        return;
                    }

                    finished = true;

                    clearTimeout(timeout);

                    spotifyServer = null;

                    reject(error);
                }
            );


            spotifyServer.listen(
                SPOTIFY_CALLBACK_PORT,
                "127.0.0.1"
            );
        }
    );
}


// ==========================================
// SPOTIFY LOGIN
// ==========================================

ipcMain.handle(
    "spotify-login",

    async (
        event,
        authUrl
    ) => {

        if (
            typeof authUrl !== "string" ||
            !authUrl.startsWith(
                "https://accounts.spotify.com/"
            )
        ) {
            throw new Error(
                "Invalid Spotify authorization URL."
            );
        }


        const callbackPromise =
            waitForSpotifyCallback();


        try {
            await shell.openExternal(
                authUrl
            );

            const result =
                await callbackPromise;


            if (
                mainWindow &&
                !mainWindow.isDestroyed()
            ) {
                mainWindow.show();
                mainWindow.focus();
            }


            return result;
        } catch (error) {
            closeSpotifyServer();

            throw error;
        }
    }
);


// ==========================================
// QUIT ORBIT
// ==========================================

ipcMain.on(
    "orbit-quit",
    () => {
        closeSpotifyServer();
        app.quit();
    }
);


// ==========================================
// START ORBIT
// ==========================================

app.whenReady().then(() => {
    createWindow();

    app.on(
        "activate",
        () => {
            if (
                BrowserWindow
                    .getAllWindows()
                    .length === 0
            ) {
                createWindow();
            }
        }
    );
});


// ==========================================
// CLOSE ORBIT
// ==========================================

app.on(
    "window-all-closed",
    () => {
        ``
        closeSpotifyServer();

        if (
            process.platform !==
            "darwin"
        ) {
            app.quit();
        }
    }
);
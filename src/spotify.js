const CLIENT_ID =
    import.meta.env.VITE_SPOTIFY_CLIENT_ID;

const REDIRECT_URI =
    "http://127.0.0.1:43821/callback";

const SCOPES = [
    "user-read-currently-playing",
    "user-read-playback-state",
    "user-modify-playback-state"
];


// ==========================================
// RANDOM STRING
// ==========================================

function generateRandomString(length) {
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    return Array.from(
        crypto.getRandomValues(
            new Uint8Array(length)
        ),
        value =>
            characters[
            value %
            characters.length
            ]
    ).join("");
}


// ==========================================
// PKCE CHALLENGE
// ==========================================

async function generateCodeChallenge(
    verifier
) {
    const data =
        new TextEncoder().encode(
            verifier
        );

    const digest =
        await crypto.subtle.digest(
            "SHA-256",
            data
        );

    return btoa(
        String.fromCharCode(
            ...new Uint8Array(
                digest
            )
        )
    )
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}


// ==========================================
// CONNECT SPOTIFY
// ==========================================

export async function connectSpotify() {
    if (!CLIENT_ID) {
        throw new Error(
            "Spotify Client ID is missing."
        );
    }


    if (
        !window.orbit?.startSpotifyLogin
    ) {
        throw new Error(
            "Orbit desktop login is unavailable."
        );
    }


    const verifier =
        generateRandomString(64);

    const challenge =
        await generateCodeChallenge(
            verifier
        );

    const state =
        generateRandomString(24);


    sessionStorage.setItem(
        "spotify_verifier",
        verifier
    );

    sessionStorage.setItem(
        "spotify_state",
        state
    );


    const params =
        new URLSearchParams({
            client_id: CLIENT_ID,

            response_type:
                "code",

            redirect_uri:
                REDIRECT_URI,

            code_challenge_method:
                "S256",

            code_challenge:
                challenge,

            state,

            scope:
                SCOPES.join(" "),

            // Forces Spotify to show the
            // authorization screen again.
            // Useful when another person
            // wants to sign into Orbit.
            show_dialog:
                "true"
        });


    const authUrl =
        `https://accounts.spotify.com/authorize?${params}`;


    const result =
        await window.orbit.startSpotifyLogin(
            authUrl
        );


    if (!result?.code) {
        throw new Error(
            "Spotify did not return an authorization code."
        );
    }


    if (
        !result.state ||
        result.state !== state
    ) {
        throw new Error(
            "Spotify login verification failed."
        );
    }


    await exchangeCodeForTokens(
        result.code,
        verifier
    );


    sessionStorage.removeItem(
        "spotify_state"
    );

    sessionStorage.removeItem(
        "spotify_verifier"
    );


    return true;
}


// ==========================================
// TOKEN EXCHANGE
// ==========================================

async function exchangeCodeForTokens(
    code,
    verifier
) {
    const response =
        await fetch(
            "https://accounts.spotify.com/api/token",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },

                body:
                    new URLSearchParams({
                        client_id:
                            CLIENT_ID,

                        grant_type:
                            "authorization_code",

                        code,

                        redirect_uri:
                            REDIRECT_URI,

                        code_verifier:
                            verifier
                    })
            }
        );


    if (!response.ok) {
        const text =
            await response.text();

        console.error(
            "Spotify token error:",
            text
        );

        throw new Error(
            "Spotify login failed. Please try again."
        );
    }


    const tokens =
        await response.json();

    saveTokens(tokens);
}


// ==========================================
// OLD CALLBACK COMPATIBILITY
// ==========================================

export async function handleSpotifyCallback() {
    // The desktop version now handles
    // Spotify callbacks through Electron.
    //
    // We keep this function so App.jsx
    // does not need to be changed.

    return false;
}


// ==========================================
// SAVE TOKENS
// ==========================================

function saveTokens(data) {
    let previous = {};


    try {
        previous =
            JSON.parse(
                sessionStorage.getItem(
                    "spotify_tokens"
                ) || "{}"
            );
    } catch {
        sessionStorage.removeItem(
            "spotify_tokens"
        );
    }


    sessionStorage.setItem(
        "spotify_tokens",

        JSON.stringify({
            ...previous,

            ...data,

            expires_at:
                Date.now() +
                data.expires_in *
                1000
        })
    );
}


// ==========================================
// CONNECTION STATUS
// ==========================================

export function isConnected() {
    return Boolean(
        sessionStorage.getItem(
            "spotify_tokens"
        )
    );
}


// ==========================================
// LOG OUT
// ==========================================

export function disconnectSpotify() {
    sessionStorage.removeItem(
        "spotify_tokens"
    );

    sessionStorage.removeItem(
        "spotify_state"
    );

    sessionStorage.removeItem(
        "spotify_verifier"
    );
}


// ==========================================
// GET ACCESS TOKEN
// ==========================================

async function getAccessToken() {
    let tokens;


    try {
        tokens =
            JSON.parse(
                sessionStorage.getItem(
                    "spotify_tokens"
                ) || "{}"
            );
    } catch {
        disconnectSpotify();

        throw new Error(
            "Spotify session is invalid. Please reconnect."
        );
    }


    if (!tokens.access_token) {
        throw new Error(
            "Please connect your Spotify account."
        );
    }


    if (
        Date.now() <
        tokens.expires_at -
        60000
    ) {
        return tokens.access_token;
    }


    if (!tokens.refresh_token) {
        disconnectSpotify();

        throw new Error(
            "Spotify session expired. Please reconnect."
        );
    }


    const response =
        await fetch(
            "https://accounts.spotify.com/api/token",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },

                body:
                    new URLSearchParams({
                        grant_type:
                            "refresh_token",

                        refresh_token:
                            tokens.refresh_token,

                        client_id:
                            CLIENT_ID
                    })
            }
        );


    if (!response.ok) {
        disconnectSpotify();

        throw new Error(
            "Your Spotify session expired. Please reconnect."
        );
    }


    const updated =
        await response.json();

    saveTokens(updated);


    const saved =
        JSON.parse(
            sessionStorage.getItem(
                "spotify_tokens"
            )
        );


    return saved.access_token;
}


// ==========================================
// SPOTIFY API REQUEST
// ==========================================

export async function spotifyRequest(
    path,
    options = {}
) {
    const token =
        await getAccessToken();


    const response =
        await fetch(
            `https://api.spotify.com/v1${path}`,
            {
                ...options,

                headers: {
                    Authorization:
                        `Bearer ${token}`,

                    ...options.headers
                }
            }
        );


    const text =
        await response.text();


    if (!response.ok) {
        console.error(
            "Spotify API error:",
            {
                path,

                status:
                    response.status,

                body:
                    text
            }
        );


        if (
            response.status === 401
        ) {
            disconnectSpotify();
        }


        throw new Error(
            `Spotify error ${response.status}`
        );
    }


    // Playback commands normally
    // return an empty response.

    if (
        path.startsWith(
            "/me/player/next"
        ) ||
        path.startsWith(
            "/me/player/previous"
        ) ||
        path.startsWith(
            "/me/player/pause"
        ) ||
        path.startsWith(
            "/me/player/play"
        ) ||
        path.startsWith(
            "/me/player/seek"
        )
    ) {
        return null;
    }


    if (!text.trim()) {
        return null;
    }


    const contentType =
        response.headers.get(
            "content-type"
        ) || "";


    if (
        !contentType.includes(
            "json"
        )
    ) {
        return null;
    }


    return JSON.parse(text);
}
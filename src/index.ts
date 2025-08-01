export interface ErrorDetails {
    message?: string;
    cause?: unknown;
    stack?: string;
    name?: string;
    code?: number;
}

export interface BaseErrorBody {
    type: string
    raw?: string
    error?: ErrorDetails;
}

export interface ErrorBody extends BaseErrorBody {
    colno: number;
    filename: string;
    lineno: number;
    message: string;
    type: string;
}

function getRaw(error: Error): string | undefined {
    let rawError: string | undefined = undefined;
    try {
        rawError = JSON.stringify(error);
        if (rawError === "{}") {
            rawError = undefined;
        }
    } catch {}

    return rawError;
}

function getBaseBody(error: Error & {code?: number}): BaseErrorBody {
    return {
        error: {
            cause: error.cause,
            stack: error.stack,
            name: error.name,
            message: error.message,
            code: error?.code
        },
        type: error?.constructor?.name ?? typeof error,
        raw: getRaw(error),
    };
}

function postError(path: string, body: BaseErrorBody | ErrorBody) {
    return fetch(
        path,
        {
            method: "POST",
            body: JSON.stringify(body),
            headers: {"Content-Type": "application/json"},
            keepalive: true,
        }
    );
}

export function addErrorEventListeners() {
    window.addEventListener("error", event => {
        const {message, filename, lineno, colno, error} = event;
        const body = {
            colno,
            filename,
            lineno,
            message,
            ...getBaseBody(error)
        };

        postError("/api/report/error", body).catch(err => {
            // TODO: Make this nicer.
            console.error("An error occurred when reporting an error: ", err);
        });
    });

    window.addEventListener("unhandledrejection", event => {
        postError("/api/report/unhandled-rejection", getBaseBody(event.reason)).catch(err => {
            // TODO: Make this nicer.
            console.error("An error occurred when reporting an unhandled rejection: ", err);
        });
    });
}

export async function refreshSession(refreshUrl: URL, redirectUrl: URL) {
    const response = await fetch(refreshUrl.toString());
    if (response.status === 401) {
        const redirectUrlCopy = new URL(redirectUrl.toString());
        redirectUrlCopy.searchParams.set("redirect", window.location.href);
        return void (window.location.href = redirectUrlCopy.toString());
    } else if (!response.ok) {
        // TODO: Can HTTP response data be added to the error?
        throw new Error("The fetch refresh session has an erroneous status code.");
    }

    setTimeout(() => refreshSession(refreshUrl, redirectUrl), 3_600_000);
}

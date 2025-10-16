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
    addEventListener("error", event => {
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

    addEventListener("unhandledrejection", event => {
        postError("/api/report/unhandled-rejection", getBaseBody(event.reason)).catch(err => {
            // TODO: Make this nicer.
            console.error("An error occurred when reporting an unhandled rejection: ", err);
        });
    });
}

export async function refreshSession(refreshUrl: URL, refreshRequestInit: RequestInit, redirectUrl: URL) {
    const response = await fetch(refreshUrl.toString(), refreshRequestInit);
    if (response.status === 401) {
        const redirectUrlCopy = new URL(redirectUrl.toString());
        redirectUrlCopy.searchParams.set("redirect", window.location.href);
        return void (window.location.href = redirectUrlCopy.toString());
    } else if (!response.ok) {
        // TODO: Can HTTP response data be added to the error?
        throw new Error("The fetch refresh session has an erroneous status code.");
    }

    setTimeout(() => refreshSession(refreshUrl, refreshRequestInit, redirectUrl), 3_600_000);
}

export function setUpSpaRouting(
    paths: string[],
    getRenderableValue: (name: string) => Promise<any>,
    render: (renderableValue: unknown) => void,
) {
    const rootPath = paths.at(0)
    if (!rootPath)
        throw new Error("No root path");

    async function renderSpa(path = location.pathname) {
        const name = path === rootPath
            ? "root"
            : path.split("/").filter(Boolean).join("_").replace(/-/g, "_")
        ;
        render(new (await getRenderableValue(name)).default());
    }

    // TODO: Replace with _Navigation API_ when widely supported.

    addEventListener("click", (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0)
            return;

        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;

        // Walk the composed path to support anchors in shadow DOM
        let anchor: HTMLAnchorElement | null = null;
        for (const node of event.composedPath()) {
            if (!(node instanceof Node))
                continue;

            if (node instanceof HTMLAnchorElement && node.hasAttribute("href")) {
                anchor = node;
                break;
            }

            const scopedElement = node instanceof Element
                ? node
                : node.getRootNode()
            ;

            if (scopedElement instanceof Element) {
                anchor = scopedElement.closest("a[href]") as HTMLAnchorElement | null;
                if (anchor) {
                    break;
                }
            }
        }

        if (!anchor)
            return;

        const hyperlinkUrl = new URL(anchor.href, location.href);

        // Exclude certain attributes

        // Opens in another frame
        if (anchor.target !== "" && anchor.target.toLowerCase() !== "_self")
            return;

        // Triggers a download
        if (anchor.hasAttribute("download"))
            return;

        // Exclude certain destinations

        // External origin
        if (hyperlinkUrl.origin !== location.origin)
            return;

        // Non-SPA path
        if (!paths.includes(hyperlinkUrl.pathname))
            return;

        // The click should be handled by this event listener, not the browser.

        event.preventDefault();

        const hyperlinkDestination = hyperlinkUrl.pathname + hyperlinkUrl.search + hyperlinkUrl.hash
        const currentRelativeReference = location.pathname + location.search + location.hash;

        if (hyperlinkDestination === currentRelativeReference)
            return;

        const [pathnameAndSearch, hash = ""] = hyperlinkDestination.split("#", 2);
        if ((pathnameAndSearch || "") === (location.pathname + location.search)) {
            // Let the browser handle scrolling to anchors without re-render
            return void history.pushState(null, "", hyperlinkDestination);
        }

        history.pushState(null, "", hyperlinkDestination);

        // Ensure we start at the top for real navigations (no fragment)
        if (!hash)
            window.scrollTo({top: 0, left: 0, behavior: "auto"});

        renderSpa();
    });

    addEventListener("popstate", () => renderSpa());
    addEventListener("DOMContentLoaded", () => renderSpa());
}

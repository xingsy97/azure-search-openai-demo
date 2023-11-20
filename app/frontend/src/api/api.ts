const BACKEND_URI = "";

import { ChatAppResponse, ChatAppResponseOrError, ChatAppRequest } from "./models";
import { useLogin } from "../authConfig";
import { OnServerDataMessageArgs, WebPubSubClient } from "@azure/web-pubsub-client";

function getHeaders(idToken: string | undefined): Record<string, string> {
    var headers: Record<string, string> = {
        "Content-Type": "application/json"
    };
    // If using login, add the id token of the logged in account as the authorization
    if (useLogin) {
        if (idToken) {
            headers["Authorization"] = `Bearer ${idToken}`;
        }
    }

    return headers;
}

export async function askApi(request: ChatAppRequest, idToken: string | undefined): Promise<ChatAppResponse> {
    const response = await fetch(`${BACKEND_URI}/ask`, {
        method: "POST",
        headers: getHeaders(idToken),
        body: JSON.stringify(request)
    });

    const parsedResponse: ChatAppResponseOrError = await response.json();
    if (response.status > 299 || !response.ok) {
        throw Error(parsedResponse.error || "Unknown error");
    }

    return parsedResponse as ChatAppResponse;
}
async function getWebPubSubClient() {
    const client = new WebPubSubClient({
        getClientAccessUrl: async() => (
            await fetch("/negotiate").then(x => x.json()).then(x => x.url)
        )
    });   
    client.on("connected", (args)=> { 
        console.log(`[wps client] on connected, ConnectionId = ${args.connectionId}`); 
    })
    client.on("disconnected", () => { console.log("[wps client] on disconnected"); })
    client.on("server-message", (args: OnServerDataMessageArgs) => {
        const data = args.message.data as any;
        console.log(`[wps client][on server-message] from = ${data.from}, message = ${data.message}`);
    });
    await client.start();
    console.log(`[wps client] client started`);
    return client;
}

export async function chatApi(request: ChatAppRequest, idToken: string | undefined): Promise<Response> {
    return await fetch(`${BACKEND_URI}/chat`, {
        method: "POST",
        headers: getHeaders(idToken),
        body: JSON.stringify(request)
    });
}

const client = await getWebPubSubClient();

export async function chatApiWps(request: ChatAppRequest, idToken: string | undefined): Promise<Response> {
    console.log(`[internal] chatApi, idToken = ${idToken}, request = ${JSON.stringify(request)}`);
    (request as any).headers = getHeaders(idToken);
    
    client.sendEvent("chat", request, "json");

    const responseStream = new ReadableStream({
        start(controller) {
            const serverDataHandler = (args: OnServerDataMessageArgs) => {
                const data = args.message.data as any;
                const message = data.message;
                controller.enqueue(JSON.stringify(message));
                if (message && message.choices && message.choices[0]["finish_reason"] !== null) {
                    controller.close();
                    client.off("server-message", serverDataHandler);
                }
            };
            client.on("server-message", serverDataHandler);
        }
    });
    return new Response(responseStream, {status: 200});
}


export function getCitationFilePath(citation: string): string {
    return `${BACKEND_URI}/content/${citation}`;
}

// Friendly translation for the verbose chain error blobs that come back from
// the R-Squared SDK. The native SDK throws strings like:
//
//   Execution error: Assert Exception: abo->get_balance() >= -delta:
//   Insufficient Balance: jj-test2's balance of 0 RQRX is less than required
//   0.86869 RQRX,"data":{"code":10,"name":"assert_exception", ... <large JSON dump>
//
// This module collapses common patterns down to one clean sentence and
// strips the trailing JSON payload that contains the full signed transaction.

export function formatChainError(raw: unknown): string {
    // Pull a usable string out of whatever was thrown. EIP-1193 wallet errors
    // are plain objects like {code: 4001, message: "User rejected the request"},
    // SDK errors are Error instances, and some libs throw bare strings.
    let text: string;
    if (raw instanceof Error) {
        text = raw.message;
    } else if (typeof raw === "string") {
        text = raw;
    } else if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        // EIP-1193: {code, message, data?}
        if (typeof obj.message === "string") {
            text = obj.message;
            // Some wallets nest the real message inside data.message or cause.message
        } else if (
            obj.data &&
            typeof obj.data === "object" &&
            typeof (obj.data as Record<string, unknown>).message === "string"
        ) {
            text = (obj.data as Record<string, unknown>).message as string;
        } else if (
            obj.cause &&
            typeof obj.cause === "object" &&
            typeof (obj.cause as Record<string, unknown>).message === "string"
        ) {
            text = (obj.cause as Record<string, unknown>).message as string;
        } else {
            try {
                text = JSON.stringify(obj);
            } catch {
                text = "Unknown error";
            }
        }
        // Wallet has a pending request — user needs to check the extension popup.
        if (/already pending/i.test(text)) {
            return "Your wallet already has a connection request open. Click the MetaMask (or other wallet) icon in your browser toolbar and approve or reject the pending popup, then try again.";
        }
        // EIP-1193 standard codes — replace with friendly text when message was generic.
        if (typeof obj.code === "number") {
            const code = obj.code;
            if (code === 4001 || code === -32603) {
                // 4001 = user rejected, -32603 = internal (sometimes user rejection in MM)
                if (/reject|denied|cancell?ed/i.test(text)) {
                    return "You cancelled the request in your wallet.";
                }
            }
            if (code === 4100) {
                return "Wallet has not authorized this site. Open your wallet and approve r2dex.io.";
            }
            if (code === 4200) {
                return "Your wallet does not support this method.";
            }
            if (code === 4900) {
                return "Wallet is disconnected. Open it and try again.";
            }
            if (code === 4902) {
                return "Ethereum mainnet is not added to your wallet. Add it and retry.";
            }
        }
    } else {
        text = String(raw ?? "");
    }
    if (!text) return "Unknown error";

    // WebSocket layer messages — surface as a single user-facing string instead
    // of leaking the raw readyState/CLOSED noise from the SDK. The service
    // worker auto-retries once on these, so a user-visible message means the
    // retry also failed (node likely down).
    if (/websocket\s+state\s+error|readyState\s*[:=]?\s*[023]|not connected|connection lost|websocket closed/i.test(text)) {
        return "Lost connection to the R-Squared node. Trying to reconnect… Press Refresh in a few seconds.";
    }

    // Hard truncate: anything starting at the JSON dump is implementation noise.
    let trimmed = text;
    const jsonStart = trimmed.search(/,"data":\{|"trx":\{|"ref_block_num":/);
    if (jsonStart > 0) trimmed = trimmed.slice(0, jsonStart);
    // Drop trailing commas / quotes left over from the cut.
    trimmed = trimmed.replace(/[,"\s]+$/, "");

    // Common case: insufficient balance — pull account, amount, asset, required.
    const ins = trimmed.match(
        /Insufficient Balance:\s*([a-z0-9-]+)'s balance of ([\d.]+)\s*([A-Z]+)\s*is less than required\s*([\d.]+)\s*([A-Z]+)/i
    );
    if (ins) {
        const [, acct, have, , need, sym] = ins;
        const haveN = Number(have);
        // When have=0 and need is small (a fee), this is almost always
        // "you sent your entire balance with no room for the fee".
        if (haveN === 0) {
            return `Not enough ${sym} to cover the network fee (need ${need} ${sym}). Try sending a smaller amount so there's room for the fee.`;
        }
        return `Insufficient ${sym}: ${acct} has ${have} ${sym}, needs ${need} ${sym}.`;
    }

    // Common case: account not found.
    const noAcc = trimmed.match(
        /(?:unknown|not found|missing).*account[^.]*['"]([a-z0-9-]+)['"]/i
    );
    if (noAcc) {
        return `Account '${noAcc[1]}' not found on chain.`;
    }

    // Common case: locked / unauthorized.
    if (/missing\s+(active|owner)\s+auth/i.test(trimmed)) {
        return "Wallet is locked or the active key does not match. Unlock and retry.";
    }

    // Strip the leading "Execution error: Assert Exception:" preamble — it
    // adds noise without information.
    const cleaned = trimmed
        .replace(/^Execution error:\s*/i, "")
        .replace(/^Assert Exception:\s*/i, "")
        .replace(/^\s*abo->get_balance\(\)\s*>=\s*-delta:\s*/i, "")
        .trim();

    // Final truncation cap.
    if (cleaned.length > 240) return cleaned.slice(0, 237) + "…";
    return cleaned || "Transaction rejected by chain";
}

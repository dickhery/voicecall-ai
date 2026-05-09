import { Ed25519KeyIdentity } from "@dfinity/identity";

const identity = Ed25519KeyIdentity.generate();
const json = JSON.stringify(identity.toJSON());

console.log("Server principal:");
console.log(identity.getPrincipal().toText());
console.log("");
console.log("Add this to src/server/.env on the Windows server:");
console.log(`ICP_SERVER_IDENTITY_JSON=${json}`);

import { hash } from "bcryptjs";
let password = "";
for await (const part of process.stdin) password += part;
password = password.trimEnd();
if (password.length < 12 || Buffer.byteLength(password) > 72)
  throw new Error("Password harus 12 karakter hingga 72 byte");
console.log(await hash(password, 12));

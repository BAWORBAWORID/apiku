import { bypassModJall } from "./tes.js";

(async () => {
    console.log("Mencoba bypass URL: https://modjall.com/s/xM554Qz");
    const result = await bypassModJall("https://modjall.com/s/xM554Qz");
    console.log(JSON.stringify(result, null, 2));
})();

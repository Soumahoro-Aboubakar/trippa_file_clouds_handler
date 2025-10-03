import jwt from "jsonwebtoken";
import config from "../config/index.js";

export default function auth(req, res, next) {
  let token;
  console.log("Voici le log dans auth token : ", req);
  // 1️⃣ Cherche dans le header Authorization
  if (req.headers["authorization"]) {
    const parts = req.headers["authorization"].split(" ");
    if (parts.length === 2 && parts[0] === "Bearer") {
      token = parts[1];
    }
  }

  // 2️⃣ Optionnel : Chercher dans query param (si Flutter envoie comme ça)
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) return res.status(401).json({ error: "Token manquant" });

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    console.log(payload, " voici le log dans la fonction");
    req.user = payload.userId;
    next();
  } catch (err) {
    console.error("token error ", err);
    return res.status(401).json({ error: "Token invalide" });
  }
}

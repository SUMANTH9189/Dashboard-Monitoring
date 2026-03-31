require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const SECRET = "secretkey";

// 🔥 USER STORE (temporary memory)
let USERS = {};

// 🔥 DEVICE SYSTEM (IMPORTANT)
let DEVICE_MAP = {};  
let AVAILABLE_DEVICES = ["esp001", "esp002", "esp003"]; // you can add more

// ========================
// 🔐 SIGNUP
// ========================
app.post("/signup", (req, res) => {
  let { username, password } = req.body;

  username = username.trim().toLowerCase();

  if (!username || !password) {
    return res.status(400).send("Missing fields");
  }

  if (username.length < 8) {
    return res.status(400).send("Minimum 8 characters required");
  }

  if (USERS[username]) {
    return res.status(400).send("Username already exists ❌");
  }

  if (AVAILABLE_DEVICES.length === 0) {
    return res.status(400).send("No devices available");
  }

  // 🔥 AUTO ASSIGN DEVICE
  const deviceId = AVAILABLE_DEVICES.shift();

  USERS[username] = password;
  DEVICE_MAP[deviceId] = username;

  console.log("USER:", username, "→ DEVICE:", deviceId);

  res.send(`Signup successful ✅ Device assigned: ${deviceId}`);
});

// ========================
// 🔐 LOGIN (WITH EXPIRY)
// ========================
app.post("/login", (req, res) => {
  let { username, password } = req.body;

  username = username.trim().toLowerCase();

  if (USERS[username] === password) {

    const token = jwt.sign(
      { username },
      SECRET,
      { expiresIn: "20m" }   // ✅ 20 minutes
    );

    return res.json({ token });
  }

  res.status(401).send("Invalid credentials ❌");
});

// ========================
// 🔐 AUTH MIDDLEWARE
// ========================
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader) return res.status(403).send("No token");

  const token = authHeader.split(" ")[1];

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(401).send("Session expired ❌");

    req.user = decoded;
    next();
  });
}

// ========================
// 📡 SENSOR API (AUTO USER MAPPING)
// ========================
app.get("/sensor", async (req, res) => {
  const { temperature, humidity, deviceId } = req.query;

  if (!temperature || !humidity || !deviceId) {
    return res.status(400).send("Missing values");
  }

  const userId = DEVICE_MAP[deviceId];

  if (!userId) {
    return res.status(400).send("Device not assigned ❌");
  }

  const writeUrl =
    "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/write?org=sriot&bucket=iot_data&precision=s";

  const lineProtocol =
    `dht_sensor,userId=${userId},deviceId=${deviceId} ` +
    `temperature=${parseFloat(temperature)},humidity=${parseFloat(humidity)}`;

  try {
    await fetch(writeUrl, {
      method: "POST",
      headers: {
        Authorization: "Token " + process.env.INFLUX_TOKEN,
        "Content-Type": "text/plain"
      },
      body: lineProtocol
    });

    console.log("DATA:", deviceId, "→", userId);

    res.send("Data stored ✅");

  } catch (err) {
    console.error(err);
    res.status(500).send("Error writing data");
  }
});

// ========================
// 📊 DATA API (USER FILTER)
// ========================
app.get("/data", verifyToken, async (req, res) => {

  let rangeQuery;

  if (req.query.date) {
    const start = `${req.query.date}T00:00:00Z`;
    const end = `${req.query.date}T23:59:59Z`;

    rangeQuery = `|> range(start: time(v: "${start}"), stop: time(v: "${end}"))`;
  } else {
    const range = req.query.range || "1h";
    rangeQuery = `|> range(start: -${range})`;
  }

  const username = req.user.username;

  const query = `
    from(bucket: "iot_data")
      ${rangeQuery}
      |> filter(fn: (r) => r._measurement == "dht_sensor")
      |> filter(fn: (r) => r["userId"] == "${username}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
      |> keep(columns: ["_time","temperature","humidity"])
      |> sort(columns: ["_time"])
  `;

  try {
    const response = await fetch(
      "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/query?org=sriot",
      {
        method: "POST",
        headers: {
          Authorization: "Token " + process.env.INFLUX_TOKEN,
          "Content-Type": "application/vnd.flux"
        },
        body: query
      }
    );

    const text = await response.text();
    const lines = text.split("\n");

    let temperature = [];
    let humidity = [];
    let time = [];

    lines.forEach(line => {

      if (
        line.startsWith("#") ||
        line.includes("_time") ||
        line.trim() === ""
      ) return;

      const cols = line.split(",");
      if (cols.length < 6) return;

      const ts = cols[3];
      const temp = parseFloat(cols[cols.length - 2]);
      const hum = parseFloat(cols[cols.length - 1]);

      if (!isNaN(temp) && !isNaN(hum)) {
        temperature.push(temp);
        humidity.push(hum);

        const d = new Date(ts);
        time.push(
          d.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })
        );
      }
    });

    res.json({ temperature, humidity, time });

  } catch (err) {
    console.log(err);
    res.status(500).send("Error");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});
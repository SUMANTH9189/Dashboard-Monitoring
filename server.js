require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");
const mongoose = require("mongoose");
const fetch = require("node-fetch");

const User = require("./models/User");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ========================
// 🔐 SECRET KEY
// ========================
const SECRET = process.env.JWT_SECRET || "secretkey";

// ========================
// 🔥 MONGODB CONNECTION
// ========================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => console.log("Mongo Error:", err));

// ========================
// 🔥 AVAILABLE DEVICES
// ========================
let AVAILABLE_DEVICES = ["esp001", "esp002", "esp003"];

// ========================
// 🏠 HOME ROUTE
// ========================
app.get("/", (req, res) => {
  res.send("IoT Backend Running ✅");
});

// ========================
// 🔐 SIGNUP
// ========================
app.post("/signup", async (req, res) => {

  try {

    let { username, password } = req.body;

    username = username?.trim().toLowerCase();
    password = password?.trim();

    if (!username || !password) {
      return res.status(400).json({
        message: "Missing fields ❌"
      });
    }

    if (username.length < 4) {
      return res.status(400).json({
        message: "Username too short ❌"
      });
    }

    // Check existing user
    const existingUser = await User.findOne({ username });

    if (existingUser) {
      return res.status(400).json({
        message: "Username already exists ❌"
      });
    }

    // Check available devices
    if (AVAILABLE_DEVICES.length === 0) {
      return res.status(400).json({
        message: "No devices available ❌"
      });
    }

    // Assign device
    const deviceId = AVAILABLE_DEVICES.shift();

    // Save user
    const newUser = new User({
      username,
      password,
      deviceId
    });

    await newUser.save();

    console.log("USER:", username, "→ DEVICE:", deviceId);

    res.json({
      message: "Signup successful ✅",
      deviceId
    });

  } catch (err) {

    console.log("Signup Error:", err);

    res.status(500).json({
      message: "Server error ❌"
    });
  }
});

// ========================
// 🔐 LOGIN
// ========================
app.post("/login", async (req, res) => {

  try {

    let { username, password } = req.body;

    username = username?.trim().toLowerCase();
    password = password?.trim();

    const user = await User.findOne({ username });

    if (!user || user.password !== password) {
      return res.status(401).json({
        message: "Invalid credentials ❌"
      });
    }

    const token = jwt.sign(
      { username },
      SECRET,
      { expiresIn: "5m" }
    );

    res.json({ token });

  } catch (err) {

    console.log("Login Error:", err);

    res.status(500).json({
      message: "Server error ❌"
    });
  }
});

// ========================
// 🔐 VERIFY TOKEN
// ========================
function verifyToken(req, res, next) {

  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(403).send("No token ❌");
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, SECRET, (err, decoded) => {

    if (err) {
      return res.status(401).send("Session expired ❌");
    }

    req.user = decoded;

    next();
  });
}

// ========================
// 📡 SENSOR API
// ========================
app.get("/sensor", async (req, res) => {

  try {

    const {
      temperature,
      humidity,
      deviceId
    } = req.query;

    // Check missing values
    if (!temperature || !humidity || !deviceId) {
      return res.status(400).send("Missing values ❌");
    }

    // Find user from deviceId
    const user = await User.findOne({ deviceId });

    if (!user) {
      return res.status(400).send("Device not assigned ❌");
    }

    const userId = user.username;

    // InfluxDB write URL
    const writeUrl =
      "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/write?org=sriot&bucket=iot_data&precision=s";

    // Line protocol
    const lineProtocol =
      `dht_sensor,userId=${userId},deviceId=${deviceId} ` +
      `temperature=${parseFloat(temperature)},humidity=${parseFloat(humidity)}`;

    // Write to InfluxDB
    const influxResponse = await fetch(writeUrl, {
  method: "POST",
  headers: {
    Authorization: "Token " + process.env.INFLUX_TOKEN,
    "Content-Type": "text/plain"
  },
  body: lineProtocol
});

const responseText = await influxResponse.text();

console.log("Influx Status:", influxResponse.status);
console.log("Influx Response:", responseText);

    console.log(
      "DATA:",
      deviceId,
      "→",
      userId,
      "| Temp:",
      temperature,
      "| Hum:",
      humidity
    );

    res.send("Data stored ✅");

  } catch (err) {

    console.error("Sensor Error:", err);

    res.status(500).send("Error writing data ❌");
  }
});

// ========================
// 📊 DATA API
// ========================
app.get("/data", verifyToken, async (req, res) => {

  try {

    let rangeQuery;

    // Date filter
    if (req.query.date) {

      const start = `${req.query.date}T00:00:00Z`;
      const end = `${req.query.date}T23:59:59Z`;

      rangeQuery =
        `|> range(start: time(v: "${start}"), stop: time(v: "${end}"))`;

    } else {

      const range = req.query.range || "1h";

      rangeQuery = `|> range(start: -${range})`;
    }

    const username = req.user.username;

    // Flux Query
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

    // Query InfluxDB
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

      const hum = parseFloat(cols[cols.length - 2]);
      const temp = parseFloat(cols[cols.length - 1]);

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

    res.json({
      temperature,
      humidity,
      time
    });

  } catch (err) {

    console.error("DATA API Error:", err);

    res.status(500).json({
      message: "Error fetching data ❌"
    });
  }
});

// ========================
// 🚀 START SERVER
// ========================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
});
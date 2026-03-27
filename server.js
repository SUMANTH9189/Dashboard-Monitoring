require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ SERVE FRONTEND
app.use(express.static(path.join(__dirname, "public")));

// 🔐 Dummy user
const USERS = {
  "client": "1234"
};

// 🔐 JWT Middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(403).send("No token provided");
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, "secretkey", (err, decoded) => {
    if (err) {
      return res.status(401).send("Invalid token");
    }

    req.user = decoded;
    next();
  });
}

// ✅ ROOT
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 🔐 LOGIN
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (USERS[username] === password) {
    const token = jwt.sign({ username }, "secretkey");
    return res.json({ token });
  }

  res.status(401).send("Invalid credentials");
});


// 🔥 ===============================
// 📡 ESP32 SENSOR API (NO AUTH)
// 🔥 ===============================
app.get("/sensor", async (req, res) => {
  const { temperature, humidity } = req.query;

  console.log("ESP32 Data:", temperature, humidity);

  const writeUrl =
    "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/write?org=sriot&bucket=iot_data&precision=s";

  const lineProtocol = `dht_sensor temperature=${temperature},humidity=${humidity}`;

  try {
    await fetch(writeUrl, {
      method: "POST",
      headers: {
        Authorization: "Token " + process.env.INFLUX_TOKEN,
        "Content-Type": "text/plain"
      },
      body: lineProtocol
    });

    res.send("Data stored");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error writing data");
  }
});


// 🔥 ===============================
// 📊 DASHBOARD DATA API (PROTECTED)
// 🔥 ===============================
app.get("/data", verifyToken, async (req, res) => {

  let range = req.query.range || "48h";

  const url =
    "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/query?org=sriot";

  const query = `
    from(bucket: "iot_data")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "dht_sensor")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
      |> keep(columns: ["_time", "temperature", "humidity"])
      |> sort(columns: ["_time"])
  `;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Token " + process.env.INFLUX_TOKEN,
        "Content-Type": "application/vnd.flux"
      },
      body: query
    });

    const text = await response.text();
    const lines = text.split("\n");

    let temperature = [];
    let humidity = [];
    let time = [];

    lines.forEach(line => {

      // ✅ skip only metadata lines
      if (line.startsWith("#") || line.trim() === "") return;

      const cols = line.split(",");

      // ✅ ensure it's a valid data row
      if (cols.length < 5) return;

      const temp = parseFloat(cols[cols.length - 2]);
      const hum = parseFloat(cols[cols.length - 1]);
      const ts = cols[3]; // timestamp column

      if (!isNaN(temp) && !isNaN(hum)) {
        temperature.push(temp);
        humidity.push(hum);
        time.push(new Date(ts).toLocaleTimeString());
      }

    });

    console.log("Fetched points:", temperature.length);

    res.json({ temperature, humidity, time });

  } catch (error) {
    console.log(error);
    res.status(500).send("Error fetching data");
  }
});

// ▶ START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
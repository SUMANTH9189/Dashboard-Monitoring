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

  const writeUrl = "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/write?org=sriot&bucket=iot_data&precision=s";

  const lineProtocol = `dht_sensor temperature=${temperature},humidity=${humidity}`;

  try {
    await fetch(writeUrl, {
      method: "POST",
      headers: {
        "Authorization": "Token " + process.env.INFLUX_TOKEN,
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

  const url = "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/query?org=sriot";

  const query = `
    from(bucket: "iot_data")
      |> range(start: -2d)
      |> filter(fn: (r) => r._measurement == "dht_sensor")
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  `;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Token " + process.env.INFLUX_TOKEN,
        "Content-Type": "application/vnd.flux"
      },
      body: query
    });

    const text = await response.text();

    const lines = text.split("\n");

    let temperature = [];
    let humidity = [];

    lines.forEach(line => {
      const cols = line.split(",");

      if (cols.length > 6 && !isNaN(parseFloat(cols[6]))) {

        if (line.includes("temperature")) {
          temperature.push(parseFloat(cols[6]));
        }

        if (line.includes("humidity")) {
          humidity.push(parseFloat(cols[6]));
        }
      }
    });

    res.json({ temperature, humidity });

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
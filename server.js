require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const USERS = { "client": "1234" };

// 🔐 AUTH
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(403).send("No token");

  const token = authHeader.split(" ")[1];

  jwt.verify(token, "secretkey", (err, decoded) => {
    if (err) return res.status(401).send("Invalid token");
    req.user = decoded;
    next();
  });
}

// 🔐 LOGIN
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (USERS[username] === password) {
    const token = jwt.sign({ username }, "secretkey");
    return res.json({ token });
  }

  res.status(401).send("Invalid credentials");
});

// 📡 SENSOR API
app.get("/sensor", async (req, res) => {
  const { temperature, humidity } = req.query;

  if (!temperature || !humidity) {
    return res.status(400).send("Missing values");
  }

  const writeUrl =
    "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/write?org=sriot&bucket=iot_data&precision=s";

  const lineProtocol = `dht_sensor temperature=${parseFloat(temperature)},humidity=${parseFloat(humidity)}`;

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

// 📊 DATA API
app.get("/data", verifyToken, async (req, res) => {

  let rangeQuery;

  if (req.query.date) {
    const start = `${req.query.date}T00:00:00Z`;
    const end = `${req.query.date}T23:59:59Z`;
    rangeQuery = `|> range(start: ${start}, stop: ${end})`;
  } else {
    let range = req.query.range || "1h";
    rangeQuery = `|> range(start: -${range})`;
  }

  const query = `
    from(bucket: "iot_data")
      ${rangeQuery}
      |> filter(fn: (r) => r._measurement == "dht_sensor")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
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
        line.includes("result") ||
        line.includes("table") ||
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
        time.push(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
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
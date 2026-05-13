module.exports = (_request, response) => {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ status: "ok" }));
};

const { handleRequest, initializeApp } = require("../src/server");

let initPromise;

async function ensureInitialized() {
  initPromise ||= initializeApp();
  return initPromise;
}

module.exports = async (request, response) => {
  try {
    await ensureInitialized();
    await handleRequest(request, response);
  } catch (error) {
    console.error(error.message || error);

    if (!response.headersSent) {
      response.statusCode = error.statusCode || 500;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          message:
            response.statusCode === 500
              ? "Internal server error."
              : error.message,
        }),
      );
    } else {
      response.end();
    }
  }
};

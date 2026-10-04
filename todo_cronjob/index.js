const required = (name) => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
};

const requiredInt = (name) => {
  const value = parseInt(required(name), 10);
  if (Number.isNaN(value) || value <= 0) {
    console.error(`Environment variable ${name} must be a positive integer`);
    process.exit(1);
  }
  return value;
};

const randomArticleUrl = required('RANDOM_ARTICLE_URL');
const backendUrl = required('TODO_BACKEND_URL');
const userAgent = required('USER_AGENT');
const timeoutMs = requiredInt('REQUEST_TIMEOUT_MS');

// Special:Random answers with a redirect; the article is in the Location header.
const getRandomArticle = async () => {
  const response = await fetch(randomArticleUrl, {
    redirect: 'manual',
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const location = response.headers.get('location');
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error(`Expected a redirect from ${randomArticleUrl}, got status ${response.status}`);
  }
  return new URL(location, randomArticleUrl).toString();
};

const createTodo = async (todo) => {
  const response = await fetch(`${backendUrl}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todo }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`todo-backend answered ${response.status}: ${await response.text()}`);
  }
  return response.json();
};

const main = async () => {
  const article = await getRandomArticle();
  const created = await createTodo(`Read ${article}`);
  console.log(`Created todo ${created.id}: ${created.todo}`);
};

main().catch((err) => {
  console.error(`Could not create the todo: ${err.message}`);
  process.exit(1);
});

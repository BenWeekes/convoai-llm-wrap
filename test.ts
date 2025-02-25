// test.ts
import { Configuration, OpenAIApi } from 'openai';

(async () => {
  const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
  const openai = new OpenAIApi(configuration);
  const models = await openai.listModels();
  console.log(models.data);
})();


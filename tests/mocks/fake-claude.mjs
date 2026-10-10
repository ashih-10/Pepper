// A fake Claude API for local testing of the edge functions. It records each
// request and returns canned structured output. Never used in production.
import http from 'node:http';
import fs from 'node:fs';

const LOG = process.env.FAKE_CLAUDE_LOG ?? 'fake-claude-requests.jsonl';
const port = Number(process.env.PORT ?? 4010);

const extractOut = {
  tasks: [
    { title: 'Unit 3 Test', class_name: 'ap chem', due_date: '2026-10-16', due_time: '08:00', task_type: 'test',
      custom_label: null, custom_tier: null, weight_pct: 15, notes: 'Covers ch. 7-9', unclear: [], question: null },
    { title: 'Lab report', class_name: 'Biology', due_date: '2026-13-40', due_time: null, task_type: 'custom',
      custom_label: 'Lab', custom_tier: null, weight_pct: null, notes: null, unclear: ['due_date'],
      question: 'When is the lab report due?' },
  ],
  message: null,
};

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    fs.appendFileSync(LOG, JSON.stringify({ path: req.url, headers: req.headers, body: parsed }) + '\n');
    const isPlan = String(JSON.stringify(parsed.system)).includes('planning coach');
    const ids = isPlan ? [...JSON.stringify(parsed.messages).matchAll(/id=([\w-]+)/g)].map((m) => m[1]) : [];
    const out = isPlan
      ? { headline: 'Two hot ones today, you got this.', steps: ids.reverse().map((id) => ({ task_id: id, tip: 'Start with a 10-minute outline.', minutes: 25 })).concat([{ task_id: 'made-up', tip: 'x', minutes: 5 }]), closing: 'Milk time after.' }
      : extractOut;
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_fake' });
    res.end(JSON.stringify({
      id: 'msg_fake', type: 'message', role: 'assistant', model: parsed.model,
      content: [{ type: 'text', text: JSON.stringify(out) }],
      stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
}).listen(port, '0.0.0.0', () => console.log(`fake claude on :${port}`));

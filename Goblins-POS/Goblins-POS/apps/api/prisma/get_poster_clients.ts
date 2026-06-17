const token = '608147:008369291fa894e30ff02d042efb7a04';
const subdomain = 'goblins-yard2';

async function main() {
  const url = `https://${subdomain}.joinposter.com/api/clients.getClients?token=${token}`;
  console.log('Fetching clients from:', url);
  const res = await fetch(url);
  const json = await res.json() as any;
  
  if (json.error) {
    console.error('Poster API error:', json.error);
    return;
  }
  
  const clients = json.response || [];
  console.log(`Fetched ${clients.length} clients.`);
  if (clients.length > 0) {
    console.log('Sample client object:', JSON.stringify(clients[0], null, 2));
  }
}

main().catch(console.error);

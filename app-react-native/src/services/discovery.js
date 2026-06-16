export async function autoDiscoverServer(onProgress) {
  let expoNetwork;
  try {
    // Dynamically require expo-network to prevent crash if not installed
    expoNetwork = require('expo-network');
  } catch(e) {
    if (onProgress) onProgress('expo-network not available. Using common subnets...');
  }
  
  const commonSubnets = ['192.168.68', '192.168.1', '192.168.0', '192.168.43', '10.0.0'];
  let subnetsToScan = [...commonSubnets];

  if (expoNetwork) {
    try {
      const ip = await expoNetwork.getIpAddressAsync();
      if (ip && ip.includes('.')) {
        const subnet = ip.substring(0, ip.lastIndexOf('.'));
        if (!commonSubnets.includes(subnet)) {
          subnetsToScan.unshift(subnet);
        } else {
          // move it to front
          subnetsToScan = subnetsToScan.filter(s => s !== subnet);
          subnetsToScan.unshift(subnet);
        }
      }
    } catch(e) {}
  }

  // Commonly leased host address pools from .2 to .254
  const hosts = Array.from({ length: 253 }, (_, i) => i + 2);
  const ports = [3000];
  
  if (onProgress) onProgress('Beginning local PiStream discovery...');
  
  for (const subnet of subnetsToScan) {
    if (onProgress) onProgress(`Probing subnet ${subnet}.x ...`);
    
    // Scan in batches of 15 in parallel 
    const batchSize = 15;
    for (let i = 0; i < hosts.length; i += batchSize) {
      const batch = hosts.slice(i, i + batchSize);
      
      const probePromises = batch.map(async (host) => {
        const ip = `${subnet}.${host}`;
        for (const port of ports) {
          const url = `http://${ip}:${port}`;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const fetchPromise = fetch(`${url}/api/discover`, {
              signal: controller.signal,
              headers: { 'Accept': 'application/json' }
            });
            
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('timeout')), 2000)
            );
            
            const res = await Promise.race([fetchPromise, timeoutPromise]);
            clearTimeout(timeoutId);
            
            const data = await res.json();
            if (data && data.service === 'pistream') {
              return url;
            }
          } catch (e) {
            // Connection refused / timed out is ignored
          }
        }
        return null;
      });
      
      const results = await Promise.all(probePromises);
      const foundUrl = results.find(r => r !== null);
      if (foundUrl) {
        return foundUrl;
      }
    }
  }
  
  return null;
}

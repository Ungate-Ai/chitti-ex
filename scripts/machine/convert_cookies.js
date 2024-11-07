const fs = require('fs');

function transformCookies(cookiesArray) {
  try {
    // Parse the input if it's a string
    const cookies = typeof cookiesArray === 'string' ? JSON.parse(cookiesArray) : cookiesArray;
    
    // Filter only essential cookies and format them specifically for tough-cookie
    const essentialCookies = cookies
      .filter(cookie => 
        (cookie.domain === '.twitter.com' || cookie.domain === 'twitter.com') && 
        ['auth_token', 'ct0'].includes(cookie.name)
      )
      .map(cookie => ({
        key: cookie.name,
        value: cookie.value,
        domain: 'twitter.com', // Remove the dot prefix
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        hostOnly: false
      }));

    // Convert to string and escape any special characters
    const cookieString = JSON.stringify(essentialCookies)
      .replace(/'/g, "'\\''");

    const outputs = {
      bash: `export TWITTER_COOKIES='${cookieString}'`,
      env: `TWITTER_COOKIES='${cookieString}'`
    };

    return outputs;
  } catch (error) {
    console.error('Error transforming cookies:', error);
    return null;
  }
}

function main() {
  // Sample cookie string from your .env file
  const inputString = `[{"domain":".twitter.com","expirationDate":1760513808.474939,"hostOnly":false,"httpOnly":false,"name":"guest_id","path":"/","sameSite":"no_restriction","secure":true,"session":false,"storeId":"0","value":"v1%3A172883975039713554"},{"domain":".twitter.com","expirationDate":1762342179.67379,"hostOnly":false,"httpOnly":false,"name":"night_mode","path":"/","sameSite":"no_restriction","secure":true,"session":false,"storeId":"0","value":"2"},{"domain":".twitter.com","expirationDate":1765324469.173626,"hostOnly":false,"httpOnly":true,"name":"auth_token","path":"/","sameSite":"no_restriction","secure":true,"session":false,"storeId":"0","value":"0479b4c0670373fab82764d62f543f6ac3caea85"},{"domain":".twitter.com","expirationDate":1765324469.587126,"hostOnly":false,"httpOnly":false,"name":"ct0","path":"/","sameSite":"lax","secure":true,"session":false,"storeId":"0","value":"5c46c9728b423128de205db9ef2edd6efbf89634ca5cc21facf03dc38836ece4189381658c68266bb5fc6c22800d6743286bf52ee69ad383276ce826371c3ddc45c90535a7ade98493adc83f5c0cf923"}]`;

  const envStrings = transformCookies(inputString);
  
  if (envStrings) {
    console.log('\nFor .env file:');
    console.log(envStrings.env);
    
    console.log('\nFor Bash/Linux/Mac:');
    console.log(envStrings.bash);
  }
}

main();
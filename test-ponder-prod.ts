async function testPonderREST() {
  const ponderUrl = "https://ponder-payroll-aucxhrb3hmhfd3fh.indonesiacentral-01.azurewebsites.net";
  
  // Alamat HR dari E2ETest.s.sol
  const hrAddress = "0x906B34db1a8DD333ff9a84255e4AEc13C054f120";
  const endpoint = `${ponderUrl}/company/${hrAddress}`;
  
  console.log(`Mengirim request REST ke ${endpoint} ...\n`);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) {
      console.error(`HTTP Error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error("Response body:", text);
      return;
    }

    const data = await response.json();
    console.log("✅ BERHASIL! Ini balasan dari Ponder REST API di Azure:");
    console.dir(data, { depth: null, colors: true });

  } catch (error) {
    console.error("❌ Gagal menghubungi Ponder:", error);
  }
}

testPonderREST();

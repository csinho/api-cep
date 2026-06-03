import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

function limparCep(cep) {
  return String(cep || "").replace(/\D/g, "");
}

function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function consultarNominatim(endereco, nivel) {
  const url = new URL("https://nominatim.openstreetmap.org/search");

  url.searchParams.set("q", endereco);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("accept-language", "pt-BR");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "API-CEP/1.0 csinho.01@gmail.com"
    }
  });

  if (!response.ok) {
    throw new Error("Erro ao consultar Nominatim/OpenStreetMap.");
  }

  const data = await response.json();

  if (Array.isArray(data) && data.length > 0) {
    return {
      encontrou: true,
      latitude: data[0].lat || "",
      longitude: data[0].lon || "",
      endereco_completo: data[0].display_name || endereco,
      endereco_usado_na_busca: endereco,
      nivel_localizacao: nivel
    };
  }

  return null;
}

async function buscarCoordenadasComFallback({ rua, bairro, cidade, uf, pais, cep }) {
  const tentativas = [];

  if (rua && bairro && cidade && uf) {
    tentativas.push({
      endereco: `${rua}, ${bairro}, ${cidade}, ${uf}, ${pais}`,
      nivel: "Rua + bairro + cidade"
    });
  }

  if (rua && cidade && uf) {
    tentativas.push({
      endereco: `${rua}, ${cidade}, ${uf}, ${pais}`,
      nivel: "Rua + cidade"
    });
  }

  if (bairro && cidade && uf) {
    tentativas.push({
      endereco: `${bairro}, ${cidade}, ${uf}, ${pais}`,
      nivel: "Bairro + cidade"
    });
  }

  if (cidade && uf) {
    tentativas.push({
      endereco: `${cidade}, ${uf}, ${pais}`,
      nivel: "Cidade"
    });
  }

  if (cep) {
    tentativas.push({
      endereco: `${cep}, ${pais}`,
      nivel: "CEP"
    });
  }

  for (let i = 0; i < tentativas.length; i++) {
    const tentativa = tentativas[i];

    const resultado = await consultarNominatim(
      tentativa.endereco,
      tentativa.nivel
    );

    if (resultado && resultado.encontrou) {
      return resultado;
    }

    await aguardar(1000);
  }

  return {
    encontrou: false,
    latitude: "",
    longitude: "",
    endereco_completo: [rua, bairro, cidade, uf, pais].filter(Boolean).join(", "),
    endereco_usado_na_busca: "Nenhuma tentativa encontrou coordenadas",
    nivel_localizacao: "Não encontrada"
  };
}

app.get("/", (req, res) => {
  return res.json({
    success: true,
    message: "API de CEP online",
    exemplo: "/api/cep/40010000"
  });
});

app.get("/api/cep/:cep", async (req, res) => {
  try {
    const cep = limparCep(req.params.cep);

    if (cep.length !== 8) {
      return res.status(400).json({
        success: false,
        message: "CEP inválido. Informe um CEP com 8 dígitos."
      });
    }

    const urlViaCep = `https://viacep.com.br/ws/${cep}/json/`;

    const responseViaCep = await fetch(urlViaCep);

    if (!responseViaCep.ok) {
      return res.status(500).json({
        success: false,
        message: "Erro ao consultar ViaCEP."
      });
    }

    const dadosViaCep = await responseViaCep.json();

    if (dadosViaCep.erro) {
      return res.status(404).json({
        success: false,
        message: "CEP não encontrado no ViaCEP."
      });
    }

    const rua = dadosViaCep.logradouro || "";
    const bairro = dadosViaCep.bairro || "";
    const cidade = dadosViaCep.localidade || "";
    const uf = dadosViaCep.uf || "";
    const estado = dadosViaCep.estado || "";
    const pais = "Brasil";

    const coordenadas = await buscarCoordenadasComFallback({
      rua,
      bairro,
      cidade,
      uf,
      pais,
      cep
    });

    return res.json({
      success: true,
      cep: dadosViaCep.cep || cep,
      pais,
      estado,
      uf,
      cidade,
      bairro,
      rua,
      latitude: coordenadas.latitude,
      longitude: coordenadas.longitude,
      endereco_completo: coordenadas.endereco_completo,
      endereco_usado_na_busca: coordenadas.endereco_usado_na_busca,
      nivel_localizacao: coordenadas.nivel_localizacao,
      encontrou_coordenadas: coordenadas.encontrou,
      origem_endereco: "ViaCEP",
      origem_coordenadas: coordenadas.encontrou ? "Nominatim/OpenStreetMap" : null
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro interno ao buscar CEP.",
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
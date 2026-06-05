import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

function limparCep(cep) {
  return String(cep || "").replace(/\D/g, "");
}

function limparTexto(valor) {
  return String(valor || "").trim();
}

function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isCepGeral(cep) {
  const cepLimpo = limparCep(cep);

  if (cepLimpo.length !== 8) return false;

  return (
    cepLimpo.endsWith("000") ||
    cepLimpo.endsWith("0000") ||
    cepLimpo.endsWith("00000")
  );
}

function montarEndereco(partes) {
  return partes
    .map(parte => limparTexto(parte))
    .filter(Boolean)
    .join(", ");
}

async function consultarNominatim(endereco, nivel, precisao) {
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
      "User-Agent": "API-CEP-UPCAO/1.0 csinho.01@gmail.com"
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
      nivel_localizacao: nivel,
      precisao: precisao,
      dados_originais: data[0]
    };
  }

  return null;
}

function montarTentativas({
  cep,
  rua,
  numero,
  bairro,
  cidade,
  uf,
  pais,
  referencia,
  nome_fazenda,
  complemento,
  cep_geral
}) {
  const tentativas = [];

  /**
   * 1. Tentativas mais precisas com número
   * Exemplo:
   * 1000 Avenida Paulista, Bela Vista, São Paulo, SP, Brasil
   */
  if (numero && rua && bairro && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([numero, rua, bairro, cidade, uf, pais]),
      nivel: "Número + rua + bairro + cidade",
      precisao: "numero"
    });
  }

  if (rua && numero && bairro && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([`${rua} ${numero}`, bairro, cidade, uf, pais]),
      nivel: "Rua + número + bairro + cidade",
      precisao: "numero"
    });
  }

  if (numero && rua && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([numero, rua, cidade, uf, pais]),
      nivel: "Número + rua + cidade",
      precisao: "numero"
    });
  }

  /**
   * 2. Tentativas para fazenda / endereço rural / referência
   */
  if (nome_fazenda && referencia && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([nome_fazenda, referencia, cidade, uf, pais]),
      nivel: "Nome da fazenda + referência + cidade",
      precisao: cep_geral ? "referencia_cep_geral" : "referencia"
    });
  }

  if (nome_fazenda && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([nome_fazenda, cidade, uf, pais]),
      nivel: "Nome da fazenda + cidade",
      precisao: cep_geral ? "fazenda_cep_geral" : "fazenda"
    });
  }

  if (referencia && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([referencia, cidade, uf, pais]),
      nivel: "Referência + cidade",
      precisao: cep_geral ? "referencia_cep_geral" : "referencia"
    });
  }

  if (complemento && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([complemento, cidade, uf, pais]),
      nivel: "Complemento + cidade",
      precisao: cep_geral ? "complemento_cep_geral" : "complemento"
    });
  }

  /**
   * 3. Tentativas normais do endereço ViaCEP
   */
  if (rua && bairro && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([rua, bairro, cidade, uf, pais]),
      nivel: "Rua + bairro + cidade",
      precisao: cep_geral ? "rua_cep_geral" : "rua"
    });
  }

  if (rua && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([rua, cidade, uf, pais]),
      nivel: "Rua + cidade",
      precisao: cep_geral ? "rua_cep_geral" : "rua"
    });
  }

  if (bairro && cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([bairro, cidade, uf, pais]),
      nivel: "Bairro + cidade",
      precisao: cep_geral ? "bairro_cep_geral" : "bairro"
    });
  }

  if (cidade && uf) {
    tentativas.push({
      endereco: montarEndereco([cidade, uf, pais]),
      nivel: cep_geral ? "Cidade / CEP geral" : "Cidade",
      precisao: cep_geral ? "cep_geral" : "cidade"
    });
  }

  if (cep) {
    tentativas.push({
      endereco: montarEndereco([cep, pais]),
      nivel: "CEP",
      precisao: cep_geral ? "cep_geral" : "cep"
    });
  }

  /**
   * Remove tentativas duplicadas
   */
  const vistos = new Set();

  return tentativas.filter(item => {
    const chave = item.endereco.toLowerCase();

    if (vistos.has(chave)) {
      return false;
    }

    vistos.add(chave);
    return true;
  });
}

async function buscarCoordenadasComFallback(params) {
  const tentativas = montarTentativas(params);

  for (let i = 0; i < tentativas.length; i++) {
    const tentativa = tentativas[i];

    console.log(`[Nominatim] Tentativa ${i + 1}:`, tentativa.endereco);

    const resultado = await consultarNominatim(
      tentativa.endereco,
      tentativa.nivel,
      tentativa.precisao
    );

    if (resultado && resultado.encontrou) {
      return {
        ...resultado,
        tentativas_realizadas: i + 1
      };
    }

    await aguardar(1000);
  }

  return {
    encontrou: false,
    latitude: "",
    longitude: "",
    endereco_completo: montarEndereco([
      params.rua,
      params.numero,
      params.bairro,
      params.cidade,
      params.uf,
      params.pais
    ]),
    endereco_usado_na_busca: "Nenhuma tentativa encontrou coordenadas",
    nivel_localizacao: "Não encontrada",
    precisao: "nao_encontrada",
    tentativas_realizadas: tentativas.length,
    dados_originais: null
  };
}

app.get("/", (req, res) => {
  return res.json({
    success: true,
    message: "API de CEP online",
    exemplos: {
      cep_simples: "/api/cep/40010000",
      cep_com_numero: "/api/cep/01310100?numero=1000",
      cep_geral_com_referencia: "/api/cep/40000000?referencia=Fazenda Boa Esperança",
      cep_geral_com_fazenda: "/api/cep/40000000?nome_fazenda=Fazenda Boa Esperança&referencia=Zona Rural"
    }
  });
});

app.get("/api/cep/:cep", async (req, res) => {
  try {
    const cep = limparCep(req.params.cep);

    const numero = limparTexto(req.query.numero);
    const referencia = limparTexto(req.query.referencia);
    const nome_fazenda = limparTexto(req.query.nome_fazenda);
    const complemento = limparTexto(req.query.complemento);

    if (cep.length !== 8) {
      return res.status(400).json({
        success: false,
        message: "CEP inválido. Informe um CEP com 8 dígitos."
      });
    }

    const cep_geral = isCepGeral(cep);

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
      cep,
      rua,
      numero,
      bairro,
      cidade,
      uf,
      pais,
      referencia,
      nome_fazenda,
      complemento,
      cep_geral
    });

    const precisa_complemento = Boolean(
      cep_geral &&
      !numero &&
      !referencia &&
      !nome_fazenda &&
      !complemento
    );

    const precisa_confirmar_mapa = Boolean(
      cep_geral ||
      coordenadas.precisao === "cidade" ||
      coordenadas.precisao === "cep_geral" ||
      coordenadas.precisao === "bairro_cep_geral" ||
      coordenadas.precisao === "nao_encontrada"
    );

    let message = "";

    if (precisa_complemento) {
      message = "CEP geral encontrado. Informe número, referência, nome da fazenda, complemento ou selecione o ponto no mapa para melhorar a precisão.";
    } else if (precisa_confirmar_mapa) {
      message = "Localização aproximada. Recomendamos confirmar ou ajustar o ponto no mapa.";
    } else if (numero && coordenadas.precisao !== "numero") {
      message = "Número informado, mas a localização exata do número não foi encontrada. Retornamos a melhor aproximação disponível.";
    }

    return res.json({
      success: true,
      message,
      cep: dadosViaCep.cep || cep,
      cep_geral,
      precisa_complemento,
      precisa_confirmar_mapa,

      pais,
      estado,
      uf,
      cidade,
      bairro,
      rua,

      numero,
      referencia,
      nome_fazenda,
      complemento,

      latitude: coordenadas.latitude,
      longitude: coordenadas.longitude,
      endereco_completo: coordenadas.endereco_completo,
      endereco_usado_na_busca: coordenadas.endereco_usado_na_busca,
      nivel_localizacao: coordenadas.nivel_localizacao,
      precisao: coordenadas.precisao,
      encontrou_coordenadas: coordenadas.encontrou,
      tentativas_realizadas: coordenadas.tentativas_realizadas,

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
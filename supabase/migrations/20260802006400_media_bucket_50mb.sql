-- ImobFlux: o bucket privado de mídia do WhatsApp passa de 25 MiB para 50 MiB.
--
-- Motivo (evidência em produção): os 4 anexos recebidos que ficaram "indisponíveis" têm de 35,3 MB a 50,0 MB, todos acima
-- do limite de 26214400 bytes do bucket; o maior anexo guardado tem 25,28 MB e nenhum anexo abaixo do limite falhou.
-- O limite GLOBAL de upload do projeto (plano do Supabase) continua mandando: se for menor que 50 MiB, o upload acima dele
-- falha e a tela mostra o aviso final de "não foi possível guardar". O envio (ImobFlux -> WhatsApp) continua limitado a 25 MiB
-- pela própria função queue_outgoing_media_message; só a RECEPÇÃO muda.

update storage.buckets
set file_size_limit = 52428800
where id = 'whatsapp-media';

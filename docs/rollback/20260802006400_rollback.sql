-- Rollback de 20260802006400_media_bucket_50mb: volta o limite do bucket para 25 MiB.
-- Arquivos já guardados acima de 25 MiB continuam no Storage (o limite só vale para novos envios).
update storage.buckets
set file_size_limit = 26214400
where id = 'whatsapp-media';

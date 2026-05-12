FROM php:8.1-apache

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        git \
        unzip \
        default-mysql-client \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install mysqli

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY php.ini /usr/local/etc/php/conf.d/zz-myvivarium.ini

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

FROM ubuntu:20.04
ENV DEBIAN_FRONTEND noninteractive

RUN apt update && \
    apt upgrade -y wget perl ghostscript gnupg

WORKDIR /root/texlive-install
COPY texlive.profile .
RUN wget http://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz && \
    tar -xvf install-tl-unx.tar.gz --strip-components 1 && \
    ./install-tl -profile texlive.profile && \
    rm -rf /root/texlive-install

RUN tlmgr update --self && \
    tlmgr install xkeyval simplekv standalone preview microtype varwidth \
        chemfig etoolbox latexmk && \
    tlmgr path add

VOLUME /data
WORKDIR /data

COPY compile.sh /opt

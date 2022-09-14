FROM ubuntu:22.04
ENV DEBIAN_FRONTEND noninteractive

# install necessary packages
RUN apt update && \
    apt upgrade -y wget perl ghostscript gnupg

# install texlive
WORKDIR /root/texlive-install
COPY texlive.profile .
RUN wget http://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz && \
    tar -xvf install-tl-unx.tar.gz --strip-components 1 && \
    ./install-tl -profile texlive.profile && \
    rm -rf /root/texlive-install

# install additional packages
RUN tlmgr update --self && \
    tlmgr install xkeyval simplekv standalone preview microtype varwidth \
        chemfig etoolbox latexmk setspace pdfpages && \
    tlmgr path add

# pre-cache stuff
RUN luaotfload-tool -vv --update

VOLUME /data
WORKDIR /data

COPY compile.sh /opt

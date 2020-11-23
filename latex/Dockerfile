FROM ubuntu:20.04
ENV DEBIAN_FRONTEND noninteractive

RUN apt update
RUN apt upgrade -y wget perl

WORKDIR /root/texlive-install
RUN wget http://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz
RUN tar -xvf install-tl-unx.tar.gz --strip-components 1
COPY texlive.profile .
RUN ./install-tl -profile texlive.profile
RUN rm -rf /root/texlive-install

RUN tlmgr install dvipng xkeyval standalone preview varwidth
RUN tlmgr path add

VOLUME /data
WORKDIR /data

COPY compile.sh /opt

CMD ["/opt/compile.sh"]